import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';
import { FulfillmentStatus, PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';

import { MailService } from '../../mail/mail.service';

/**
 * What one settlement claimed for physical fulfilment, handed from the in-
 * transaction step to the post-commit step.
 *
 * `claimed` is false when there was nothing to do — a digital-only order, or an
 * order some other settlement already moved off NOT_STARTED. A false claim
 * sends no e-mail, which is what makes repeat settlements silent.
 */
export interface PhysicalFulfillmentClaim {
  orderId: number;
  claimed: boolean;
}

/** Storefront route used when `FRONTEND_URL` is unset — matches CheckoutService's fallback. */
const FRONTEND_URL_FALLBACK = 'http://localhost:5173';

/**
 * The physical half of post-payment fulfilment, and the mirror image of
 * `DigitalDeliveryService`.
 *
 * Digital lines get claimed and e-mailed; physical lines get an order that
 * enters the fulfilment queue and a confirmation e-mail. Before this existed a
 * paid printed book sat on `fulfillment_status = NOT_STARTED` forever, with no
 * message to the buyer and nothing for an admin to work from.
 *
 * The same two-phase split applies, for the same reason — a settlement is a
 * database transaction and an e-mail is not:
 *
 *  1. `markProcessing` runs INSIDE the settlement transaction, while
 *     `PaymentSettlementService` holds the order row under `FOR UPDATE`. It
 *     does nothing but flip NOT_STARTED -> PROCESSING with a conditional
 *     UPDATE. That conditional is the idempotency gate.
 *  2. `dispatchOrderConfirmation` runs AFTER the commit and sends one e-mail.
 *
 * Sending inside the transaction would mean a rollback leaves a buyer holding a
 * confirmation for a payment we did not record. Claiming first and sending
 * after inverts the failure into the harmless direction: a claimed order whose
 * e-mail never went out, which the buyer can still see on their order page.
 *
 * The admin-driven half of the lifecycle (SHIPPED / DELIVERED) lands here too,
 * via `dispatchShipmentUpdate`, so all three physical e-mails share one
 * never-throws contract and one order-URL builder.
 */
@Injectable()
export class PhysicalFulfillmentService {
  private readonly logger = new Logger(PhysicalFulfillmentService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Move a freshly-paid physical order into the fulfilment queue.
   *
   * MUST be called inside the settlement transaction, with the order row
   * already write-locked — the lock serialises two concurrent settlements of
   * the same order, and the conditional UPDATE below makes the claim
   * exactly-once *within* that serialisation.
   *
   * A no-op (and an empty claim) when:
   *  - the order has no physical line — digital-only orders are fully served by
   *    `DigitalDeliveryService` and must not get a second, redundant e-mail; or
   *  - `fulfillment_status` is anything other than NOT_STARTED, which covers
   *    both "another settlement got here first" and "an admin has already moved
   *    this order along".
   *
   * Never called for a CANCELLED order: `PaymentSettlementService` returns from
   * its cancelled-while-paying branch before reaching this point, because that
   * order needs a refund rather than fulfilment.
   *
   * @param manager the settlement transaction's entity manager — never a fresh
   *        one, or the UPDATE would land outside the lock
   */
  async markProcessing(manager: EntityManager, order: Order): Promise<PhysicalFulfillmentClaim> {
    const hasPhysicalLine = (order.items ?? []).some((item) => {
      const variant = item.bookFormatVariant;
      // The exact complement of DigitalDeliveryService's predicate, so every
      // line is handled by exactly one of the two services.
      return !!variant && isPhysicalFormat(variant.format);
    });

    if (!hasPhysicalLine) {
      return { orderId: order.id, claimed: false };
    }

    // Conditional UPDATE, expressed through the ORM so the enum type and the
    // `order_id` column name come from entity metadata rather than a hand-
    // written string. "Is this order unclaimed?" and "claim it" are the same
    // statement — two settlements that passed the check together would
    // otherwise both send a confirmation.
    const result = await manager.update(
      Order,
      { id: order.id, fulfillment_status: FulfillmentStatus.NOT_STARTED },
      { fulfillment_status: FulfillmentStatus.PROCESSING },
    );

    if (!result.affected) {
      this.logger.log(
        `Order ${order.id}: fulfilment already past NOT_STARTED — no confirmation claimed by this settlement`,
      );
      return { orderId: order.id, claimed: false };
    }

    // Keep the in-memory entity honest: `PaymentSettlementService` saves this
    // same instance afterwards, and a stale NOT_STARTED on it would write the
    // claim straight back out.
    order.fulfillment_status = FulfillmentStatus.PROCESSING;

    const statusLog = new OrderStatusLog();
    statusLog.order = { id: order.id } as Order;
    statusLog.payment_status = PaymentStatus.PAID;
    statusLog.fulfillment_status = FulfillmentStatus.PROCESSING;
    // `changed_by` is left unset: this transition has no human actor. The
    // relation is nullable, and a NULL here reads as "the system did it".
    statusLog.comment = 'Payment settled — order queued for fulfilment';
    await manager.save(OrderStatusLog, statusLog);

    this.logger.log(`Order ${order.id} moved NOT_STARTED -> PROCESSING on settlement`);

    return { orderId: order.id, claimed: true };
  }

  /**
   * Send the order-confirmation e-mail for a claim.
   *
   * MUST be called only after the settlement transaction has committed.
   *
   * Never throws. It runs from the webhook / reconciliation cron / verifyOrder
   * paths, where the payment is already recorded; turning a mail outage into a
   * 500 would make Razorpay redeliver a webhook we handled correctly and would
   * fail the storefront's `verifyOrder` poll on a genuinely paid order. Unlike
   * the digital path there is no per-line status to mark FAILED, so a failure
   * is logged and nothing else — the order is queued for fulfilment either way,
   * which is the state that actually matters.
   */
  async dispatchOrderConfirmation(claim: PhysicalFulfillmentClaim): Promise<void> {
    if (!claim.claimed) {
      return;
    }

    try {
      // Re-read: the settlement's entity graph does not carry a fresh `user`
      // and its copy is stale now that the transaction has committed.
      const order = await this.dataSource.getRepository(Order).findOne({
        where: { id: claim.orderId },
        relations: ['user'],
      });

      const email = order?.user?.email;

      if (!order || !email) {
        this.logger.error(`Order confirmation for order ${claim.orderId} has no recipient address — not sent`);
        return;
      }

      await this.mailService.sendOrderConfirmationEmail(
        email,
        order.user.firstName,
        buildOrderNumber(order.id),
        this.buildOrderUrl(order.id),
      );

      this.logger.log(`Order confirmation e-mail sent for order ${order.id}`);
    } catch (error) {
      this.logger.error(
        `Order confirmation e-mail failed for order ${claim.orderId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Send the shipped / delivered e-mail after an admin advanced an order's
   * fulfilment state.
   *
   * Called by `OrdersService.updateFulfillmentAdmin` AFTER its transaction
   * commits, and never throws: the parcel has physically moved, so a mail
   * failure must not turn a correct state change into a 500 that tempts the
   * admin to click again.
   *
   * Reads the order fresh rather than trusting the caller's entity, so the
   * message can never describe a state that was rolled back.
   *
   * @param status the transition that just happened — anything other than
   *        SHIPPED or DELIVERED has no customer e-mail and is ignored
   */
  async dispatchShipmentUpdate(orderId: number, status: FulfillmentStatus): Promise<void> {
    if (status !== FulfillmentStatus.SHIPPED && status !== FulfillmentStatus.DELIVERED) {
      return;
    }

    try {
      const order = await this.dataSource.getRepository(Order).findOne({
        where: { id: orderId },
        relations: ['user'],
      });

      const email = order?.user?.email;

      if (!order || !email) {
        this.logger.error(`Shipment notification for order ${orderId} has no recipient address — not sent`);
        return;
      }

      const orderNumber = buildOrderNumber(order.id);
      const orderUrl = this.buildOrderUrl(order.id);

      if (status === FulfillmentStatus.SHIPPED) {
        await this.mailService.sendOrderShippedEmail(
          email,
          order.user.firstName,
          orderNumber,
          order.carrier,
          order.tracking_number,
          order.tracking_url,
          orderUrl,
        );
      } else {
        await this.mailService.sendOrderDeliveredEmail(email, order.user.firstName, orderNumber, orderUrl);
      }

      this.logger.log(`${status} e-mail sent for order ${order.id}`);
    } catch (error) {
      this.logger.error(
        `${status} e-mail failed for order ${orderId} — the status change stands`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Storefront deep link the e-mails point at. Identical to the digital
   * delivery link: `/orders` is the protected order-history route and the id
   * rides along as a query param, since there is no per-order route yet.
   */
  private buildOrderUrl(orderId: number): string {
    const base = (this.configService.get<string>('FRONTEND_URL') || FRONTEND_URL_FALLBACK).replace(/\/+$/, '');
    return `${base}/orders?order=${orderId}`;
  }
}

/**
 * The customer-visible order reference. Duplicated from `OrdersService`'s
 * mapper rather than imported, to keep this service free of a dependency on the
 * orders module (which depends on this one).
 */
function buildOrderNumber(orderId: number): string {
  return `MP-${String(orderId).padStart(6, '0')}`;
}
