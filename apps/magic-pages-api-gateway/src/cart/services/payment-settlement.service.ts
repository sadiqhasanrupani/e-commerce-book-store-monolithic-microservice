import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Order } from '@app/contract/orders/entities/order.entity';
import { FulfillmentStatus, PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import {
  DigitalDeliveryClaim,
  DigitalDeliveryService,
} from '../../digital-delivery/providers/digital-delivery.service';
import {
  PhysicalFulfillmentClaim,
  PhysicalFulfillmentService,
} from '../../physical-fulfillment/providers/physical-fulfillment.service';

/**
 * What a settlement attempt did, so callers can log/report accurately.
 */
export enum SettlementOutcome {
  /** Transaction + order were moved to their terminal state by this call. */
  PROCESSED = 'processed',
  /** Nothing to do — the transaction was already in that terminal state. */
  ALREADY_PROCESSED = 'already_processed',
  /** No such transaction; the caller should not treat this as an error. */
  IGNORED = 'ignored',
  /** Payment succeeded on an order the customer already cancelled — needs a refund. */
  REFUND_REQUIRED = 'processed_refund_required',
}

/**
 * The single place where a payment result is turned into database state.
 *
 * Two callers reach the same outcome by different routes:
 *  - `PaymentWebhookController` — the gateway told us (push).
 *  - `PaymentReconciliationService` — we asked the gateway because no webhook
 *    arrived (pull).
 *
 * They used to be separate implementations, and they had drifted: the webhook
 * deducted stock on success while reconciliation only flipped the status
 * flags, so a reconciled order shipped goods that were never taken out of
 * inventory (an oversell that would only surface at fulfilment). Keeping one
 * implementation is the point of this service — a missed webhook must settle
 * *identically* to a delivered one.
 */
@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(
    private readonly dataSource: DataSource,

    /**
     * Digital delivery is the mirror of the physical stock deduction below:
     * physical lines come out of inventory, digital lines get e-mailed. Both
     * are triggered from here so a payment observed by any of the three callers
     * produces identical state.
     */
    private readonly digitalDeliveryService: DigitalDeliveryService,

    /**
     * The physical counterpart. Where digital lines get e-mailed, physical
     * lines put the order into the fulfilment queue (NOT_STARTED -> PROCESSING)
     * and send the buyer a confirmation. Same two-phase claim/dispatch shape,
     * driven from here so that a payment observed by any of the three callers
     * produces identical state.
     */
    private readonly physicalFulfillmentService: PhysicalFulfillmentService,
  ) {}

  /**
   * Settle a successful payment: transaction -> SUCCESS, order -> PAID,
   * stock permanently deducted (reservation released), cart -> COMPLETED.
   *
   * Safe to call twice for the same transaction: the second call short-circuits
   * on the transaction status re-read under the order's write lock.
   *
   * @param transactionId internal transaction UUID (never a gateway id)
   * @param rawResponsePatch merged into `transaction.raw_response` for audit
   *        (e.g. `{ webhook: body }` or `{ reconciliation: statusResponse }`)
   */
  async settleSuccess(transactionId: string, rawResponsePatch?: Record<string, any>): Promise<SettlementOutcome> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    /**
     * Digital lines this call claimed for delivery, filled in under the order
     * lock and acted on only after the commit below. Declared out here so the
     * post-commit dispatch can see it.
     */
    let digitalClaim: DigitalDeliveryClaim = { orderId: 0, itemIds: [] };

    /**
     * The physical equivalent: whether THIS call was the one that moved the
     * order into the fulfilment queue, and therefore owes the buyer an order
     * confirmation. Also filled in under the order lock, also acted on only
     * after the commit.
     */
    let physicalClaim: PhysicalFulfillmentClaim = { orderId: 0, claimed: false };

    try {
      const transaction = await queryRunner.manager.findOne(Transaction, {
        where: { id: transactionId },
        relations: ['order', 'order.items', 'order.items.bookFormatVariant', 'order.user'],
      });

      if (!transaction) {
        this.logger.error(`Settlement skipped — transaction ${transactionId} not found`);
        await queryRunner.rollbackTransaction();
        return SettlementOutcome.IGNORED;
      }

      const order = transaction.order;

      if (!order) {
        // A transaction with no order is a data problem, not a payment we can
        // settle. Bail loudly rather than throwing a TypeError deeper down.
        this.logger.error(`Settlement skipped — transaction ${transaction.id} has no order attached`);
        await queryRunner.rollbackTransaction();
        return SettlementOutcome.IGNORED;
      }

      // Take a write lock on the order row before mutating it. The customer
      // cancel endpoint (`POST /user/orders/:id/cancel`) takes the same lock,
      // as does the concurrent webhook/reconciliation path, so none of them can
      // interleave — without this, a cancel could release the stock reservation
      // while this handler decrements it again, driving reservedQuantity
      // negative (which reads as extra availability, i.e. oversell).
      const lockedOrder = await queryRunner.manager.findOne(Order, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (lockedOrder) {
        order.payment_status = lockedOrder.payment_status;
        order.fulfillment_status = lockedOrder.fulfillment_status;
      }

      // Re-read the transaction status now that we hold the order lock. This is
      // the idempotency gate: a webhook and the reconciliation cron can race for
      // the same payment, and whoever gets the lock second must find SUCCESS
      // here and do nothing.
      const currentStatus = await queryRunner.manager.findOne(Transaction, {
        where: { id: transaction.id },
        select: { id: true, status: true },
      });

      if (currentStatus?.status === TransactionStatus.SUCCESS) {
        this.logger.log(`Transaction ${transaction.id} already settled as SUCCESS`);
        await queryRunner.rollbackTransaction();
        return SettlementOutcome.ALREADY_PROCESSED;
      }

      transaction.status = TransactionStatus.SUCCESS;
      transaction.raw_response = { ...transaction.raw_response, ...rawResponsePatch };
      await queryRunner.manager.save(Transaction, transaction);

      if (order.fulfillment_status === FulfillmentStatus.CANCELLED) {
        // The customer cancelled while the payment was in flight. The money is
        // real, so record it as PAID for accounting, but do NOT deduct stock or
        // complete the cart — the reservation was already released and the
        // order is dead. This needs a refund.
        this.logger.error(
          `Payment succeeded for cancelled order ${order.id} (transaction ${transaction.id}) — refund required`,
        );
        order.payment_status = PaymentStatus.PAID;
        await queryRunner.manager.save(Order, order);
        await queryRunner.commitTransaction();
        return SettlementOutcome.REFUND_REQUIRED;
      }

      if (order.payment_status !== PaymentStatus.PAID) {
        order.payment_status = PaymentStatus.PAID;
        await queryRunner.manager.save(Order, order);

        // Permanent stock deduction (phase 2 of the 2-phase reservation):
        // stockQuantity comes down for real and the hold is released.
        //
        // Physical formats only. `CheckoutService` gates its reservation on
        // `isPhysicalFormat`, and `OrdersService.cancelOrder` gates its release
        // the same way — so decrementing every item here (which is what the old
        // inline webhook code did, complete with a TODO admitting it) took a
        // hold off a digital variant that was never placed, driving its
        // reservedQuantity negative. A negative reservation reads as extra
        // availability, which is exactly the oversell this service exists to
        // prevent.
        for (const item of order.items ?? []) {
          const variant = item.bookFormatVariant;
          if (!variant || !isPhysicalFormat(variant.format)) {
            continue;
          }

          await queryRunner.manager.decrement(BookFormatVariant, { id: variant.id }, 'stockQuantity', item.quantity);
          await queryRunner.manager.decrement(
            BookFormatVariant,
            { id: variant.id },
            'reservedQuantity',
            item.quantity,
          );
        }

        // The digital half of the same loop. Physical lines were just taken out
        // of inventory; digital lines have nothing to deduct and instead need
        // the material sent to the buyer — which, before this, simply never
        // happened: a paid ebook produced no delivery of any kind.
        //
        // Only the CLAIM happens here, inside the transaction and under the
        // order lock, so that two settlements racing on the same order cannot
        // both send. The e-mail itself goes out after the commit — see the
        // dispatch call below.
        digitalClaim = await this.digitalDeliveryService.claimDeliverableItems(queryRunner.manager, order);

        // The physical half of the same idea. Digital lines were just claimed
        // for e-mail; physical lines have a parcel to pack, so the order moves
        // NOT_STARTED -> PROCESSING and enters the admin fulfilment queue.
        // Before this, `fulfillment_status` had no writer other than the entity
        // default and `cancelOrder`, so every paid physical order read
        // NOT_STARTED forever.
        //
        // Reached only past the CANCELLED early-return above: a payment that
        // lands on a cancelled order needs a refund, not fulfilment.
        physicalClaim = await this.physicalFulfillmentService.markProcessing(queryRunner.manager, order);

        if (order.user?.id) {
          const cart = await queryRunner.manager.findOne(Cart, {
            where: { userId: order.user.id, status: CartStatus.CHECKOUT },
          });
          if (cart) {
            cart.status = CartStatus.COMPLETED;
            await queryRunner.manager.save(Cart, cart);
          }
        }
      }

      await queryRunner.commitTransaction();

      // AFTER the commit, never before: an e-mail cannot be rolled back, so a
      // buyer must not be handed their download until the payment that bought
      // it is durably recorded. `dispatchClaim` swallows its own failures (it
      // marks the lines FAILED instead) — a mail outage must not turn a settled
      // payment into a 500 that makes Razorpay retry the webhook.
      await this.digitalDeliveryService.dispatchClaim(digitalClaim);

      // Same contract, same reasoning: after the commit, and it swallows its
      // own failures. Sends nothing when this call did not make the claim, so
      // a re-settled order does not confirm itself twice.
      await this.physicalFulfillmentService.dispatchOrderConfirmation(physicalClaim);

      return SettlementOutcome.PROCESSED;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error(`Settlement (success) failed for transaction ${transactionId}`, error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Settle a failed payment: transaction -> FAILED and the cart goes back to
   * ACTIVE so the customer can retry.
   *
   * The stock reservation is deliberately NOT released here — the cart is live
   * again and the customer would otherwise lose the items mid-retry.
   * `OrderTimeoutService` releases it if they abandon.
   *
   * Takes the same order write lock as `settleSuccess`, so a late failure
   * notification can never race ahead of (and overwrite) a success.
   */
  async settleFailure(transactionId: string, rawResponsePatch?: Record<string, any>): Promise<SettlementOutcome> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const transaction = await queryRunner.manager.findOne(Transaction, {
        where: { id: transactionId },
        relations: ['order', 'order.user'],
      });

      if (!transaction) {
        this.logger.error(`Settlement skipped — transaction ${transactionId} not found`);
        await queryRunner.rollbackTransaction();
        return SettlementOutcome.IGNORED;
      }

      // Take the SAME order write lock `settleSuccess` takes, for the same
      // reason. Without it this path read the transaction status unguarded: a
      // late `payment.failed` could read PENDING, get descheduled while a
      // concurrent `payment.captured` committed SUCCESS, and then overwrite a
      // genuinely paid transaction with FAILED (leaving the order PAID and its
      // stock deducted, but the transaction row and the cart lying about it).
      // Serialising on the order row makes the status re-read below authoritative.
      if (transaction.order) {
        await queryRunner.manager.findOne(Order, {
          where: { id: transaction.order.id },
          lock: { mode: 'pessimistic_write' },
        });
      }

      // Re-read under the lock — this is the idempotency/ordering gate.
      const currentStatus = await queryRunner.manager.findOne(Transaction, {
        where: { id: transaction.id },
        select: { id: true, status: true },
      });

      if (currentStatus?.status === TransactionStatus.SUCCESS) {
        // A success already landed (webhook, reconciliation or verifyOrder).
        // Never downgrade a paid transaction on a late failure notification.
        this.logger.warn(`Ignoring FAILED result for already-successful transaction ${transaction.id}`);
        await queryRunner.rollbackTransaction();
        return SettlementOutcome.ALREADY_PROCESSED;
      }

      if (currentStatus?.status === TransactionStatus.FAILED) {
        await queryRunner.rollbackTransaction();
        return SettlementOutcome.ALREADY_PROCESSED;
      }

      transaction.status = TransactionStatus.FAILED;
      transaction.raw_response = { ...transaction.raw_response, ...rawResponsePatch };
      await queryRunner.manager.save(Transaction, transaction);

      // The transaction status is already recorded above; failing to un-park the
      // cart is a lesser problem than not recording the failure at all, so a
      // missing order/user is skipped rather than thrown.
      const ownerId = transaction.order?.user?.id;
      if (ownerId) {
        const cart = await queryRunner.manager.findOne(Cart, {
          where: { userId: ownerId, status: CartStatus.CHECKOUT },
        });
        if (cart) {
          cart.status = CartStatus.ACTIVE;
          await queryRunner.manager.save(Cart, cart);
        }
      }

      await queryRunner.commitTransaction();
      return SettlementOutcome.PROCESSED;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error(`Settlement (failure) failed for transaction ${transactionId}`, error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
