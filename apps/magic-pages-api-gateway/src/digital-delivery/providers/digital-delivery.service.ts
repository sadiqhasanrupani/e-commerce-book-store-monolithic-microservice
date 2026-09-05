import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { DigitalDeliveryStatus } from '@app/contract/orders/enums/digital-delivery-status.enum';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';

import { MailService } from '../../mail/mail.service';

/** The order lines one settlement claimed, handed from the claim step to the dispatch step. */
export interface DigitalDeliveryClaim {
  orderId: number;
  /** `order_items.order_item_id` values now sitting in SENDING because of this settlement. */
  itemIds: number[];
}

/** Storefront route used when `FRONTEND_URL` is unset — matches CheckoutService's fallback. */
const FRONTEND_URL_FALLBACK = 'http://localhost:5173';

/**
 * Delivers the digital material of a paid order by e-mail.
 *
 * Split deliberately into two phases, because a settlement is a database
 * transaction and an e-mail is not:
 *
 *  1. `claimDeliverableItems` runs INSIDE the settlement transaction, while
 *     `PaymentSettlementService` holds the order row under `FOR UPDATE`. It
 *     does nothing but flip eligible digital lines to SENDING with a
 *     conditional UPDATE. This is the idempotency gate.
 *  2. `dispatchClaim` runs AFTER that transaction commits. It sends one e-mail
 *     and records the outcome.
 *
 * The ordering is the important part. Sending the mail inside the transaction
 * would mean a rollback (a later statement failing, a lock timeout) leaves a
 * buyer holding a download e-mail for a payment we did not record — an e-mail
 * cannot be rolled back. Claiming first and sending after commit inverts the
 * failure into the harmless direction: the worst case is a claimed line whose
 * e-mail never went out, and the buyer can still download from the order page,
 * which authorises on payment state, not on delivery state.
 */
@Injectable()
export class DigitalDeliveryService {
  private readonly logger = new Logger(DigitalDeliveryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Claim the digital lines of `order` for delivery.
   *
   * MUST be called inside the settlement transaction, with the order row
   * already write-locked — the lock is what serialises two concurrent
   * settlements of the same order, and the conditional UPDATE below is what
   * makes the claim exactly-once *within* that serialisation.
   *
   * A line is claimable when it is digital and its status is NULL (never
   * attempted) or FAILED (a previous attempt's mail bounced, so a re-settlement
   * may legitimately try again). SENDING and DELIVERED are not claimable, which
   * is what stops the webhook, the reconciliation cron and `verifyOrder` from
   * each mailing the same ebook.
   *
   * @param manager the settlement transaction's entity manager — never a fresh
   *        one, or the UPDATE would land outside the lock
   * @returns the claim to hand to `dispatchClaim` after the commit; `itemIds`
   *          is empty when there is nothing (new) to deliver
   */
  async claimDeliverableItems(manager: EntityManager, order: Order): Promise<DigitalDeliveryClaim> {
    const digitalItemIds = (order.items ?? [])
      .filter((item) => {
        const variant = item.bookFormatVariant;
        // Mirror of the physical-stock branch in PaymentSettlementService: the
        // two gate on the same predicate from opposite sides, so every line is
        // handled by exactly one of them.
        return variant && !isPhysicalFormat(variant.format);
      })
      .map((item) => item.id);

    if (digitalItemIds.length === 0) {
      return { orderId: order.id, itemIds: [] };
    }

    // One statement, `RETURNING` the rows it actually changed. Written as raw
    // SQL rather than a per-item read-then-write because the atomicity is the
    // whole point: "is this line unclaimed?" and "claim it" have to be the same
    // statement, or two settlements that pass the check together would both
    // send.
    const raw: unknown = await manager.query(
      `UPDATE "order_items"
          SET "digital_delivery_status" = $1
        WHERE "order_item_id" = ANY($2::int[])
          AND ("digital_delivery_status" IS NULL OR "digital_delivery_status" = $3)
     RETURNING "order_item_id"`,
      [DigitalDeliveryStatus.SENDING, digitalItemIds, DigitalDeliveryStatus.FAILED],
    );

    // For a data-modifying statement with RETURNING, TypeORM's `query()` hands
    // back `[rows, affectedCount]` rather than the rows alone. Reading it as a
    // plain row array turned the affected count into a second, bogus "row" and
    // produced NaN ids, which then blew up the follow-up UPDATE — so normalise
    // both shapes rather than trusting either.
    const rows = (Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw) as
      | Array<{ order_item_id: number }>
      | undefined;

    const itemIds = (rows ?? []).map((row) => Number(row?.order_item_id)).filter((id) => Number.isInteger(id));

    if (itemIds.length < digitalItemIds.length) {
      // Not an error: the normal case is a second settlement of an order whose
      // material already went out.
      this.logger.log(
        `Order ${order.id}: claimed ${itemIds.length} of ${digitalItemIds.length} digital line(s); ` +
          'the rest were already delivered or in flight',
      );
    }

    return { orderId: order.id, itemIds };
  }

  /**
   * Send the download e-mail for a claim and record the outcome.
   *
   * MUST be called only after the settlement transaction has committed —
   * otherwise the buyer could be told about a payment that then rolls back.
   *
   * Never throws. It is invoked from the webhook/cron/verify paths, where the
   * payment has already been recorded successfully; turning a mail outage into
   * a 500 would make Razorpay retry a webhook we handled correctly, and would
   * fail the storefront's `verifyOrder` poll on an order that is genuinely
   * paid. Failures are recorded as FAILED on the line and logged instead.
   */
  async dispatchClaim(claim: DigitalDeliveryClaim): Promise<void> {
    if (claim.itemIds.length === 0) {
      return;
    }

    try {
      // Re-read in a fresh query: the settlement's entity graph does not carry
      // `items.bookFormatVariant.book` (it has no reason to) and its copy is
      // stale now that the transaction has committed.
      const order = await this.dataSource.getRepository(Order).findOne({
        where: { id: claim.orderId },
        relations: ['user', 'items', 'items.bookFormatVariant', 'items.bookFormatVariant.book'],
      });

      const email = order?.user?.email;

      if (!order || !email) {
        // Nothing to send to. Mark FAILED so the line is visibly undelivered
        // rather than stuck in SENDING forever.
        this.logger.error(
          `Digital delivery for order ${claim.orderId} has no recipient address — marking ${claim.itemIds.length} line(s) FAILED`,
        );
        await this.markFailed(claim.itemIds);
        return;
      }

      const titles = order.items
        .filter((item) => claim.itemIds.includes(item.id))
        .map((item) => item.bookFormatVariant?.book?.title ?? 'Your purchase');

      const orderNumber = `MP-${String(order.id).padStart(6, '0')}`;

      await this.mailService.sendDigitalDeliveryEmail(
        email,
        order.user.firstName,
        orderNumber,
        titles,
        this.buildOrderUrl(order.id),
      );

      await this.markDelivered(claim.itemIds);
      this.logger.log(`Digital delivery e-mail sent for order ${order.id} (${claim.itemIds.length} line(s))`);
    } catch (error) {
      // MailService has already retried and tripped its circuit breaker by the
      // time we get here, so this is a definitive failure for this attempt.
      this.logger.error(
        `Digital delivery failed for order ${claim.orderId} — marking ${claim.itemIds.length} line(s) FAILED`,
        error instanceof Error ? error.stack : String(error),
      );

      await this.markFailed(claim.itemIds).catch((markError) => {
        // If even the status write fails the lines stay in SENDING. Log loudly:
        // that is the one state nothing retries automatically.
        this.logger.error(
          `Could not record delivery failure for order ${claim.orderId}; line(s) left in SENDING`,
          markError instanceof Error ? markError.stack : String(markError),
        );
      });
    }
  }

  /** Storefront deep link the e-mail points at. */
  private buildOrderUrl(orderId: number): string {
    const base = (this.configService.get<string>('FRONTEND_URL') || FRONTEND_URL_FALLBACK).replace(/\/+$/, '');

    // `/orders` is the storefront's protected order-history route. There is no
    // per-order route yet, so the id rides along as a query param the orders
    // page can use to scroll to (or expand) the right order once the frontend
    // half of this feature lands. Until then the buyer lands on their order
    // list, which is where the Download button lives either way.
    return `${base}/orders?order=${orderId}`;
  }

  /**
   * `Repository.update(ids, …)` rather than an update query builder with
   * `whereInIds`: the primary key column here is `order_item_id` while the
   * entity property is `id`, and the query-builder form silently matched zero
   * rows, leaving every delivered line stuck in SENDING. `update` resolves the
   * primary-key mapping from the entity metadata, so it addresses the right
   * column.
   */
  private async markDelivered(itemIds: number[]): Promise<void> {
    await this.dataSource.getRepository(OrderItem).update(itemIds, {
      digital_delivery_status: DigitalDeliveryStatus.DELIVERED,
      digital_delivered_at: new Date(),
    });
  }

  private async markFailed(itemIds: number[]): Promise<void> {
    await this.dataSource.getRepository(OrderItem).update(itemIds, {
      digital_delivery_status: DigitalDeliveryStatus.FAILED,
    });
  }
}
