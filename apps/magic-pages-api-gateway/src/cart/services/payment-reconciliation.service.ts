import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { PaymentStatus as ProviderPaymentStatus } from '../interfaces/payment-provider.interface';
import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';
import { RazorpayProvider } from '../providers/razorpay.provider';
import { PaymentSettlementService } from './payment-settlement.service';

/**
 * Fallback recovery for payments whose webhook never arrived.
 *
 * Razorpay's `payment.captured` webhook is the primary signal that an order is
 * paid; this cron is the safety net for when it is delayed, dropped, or our
 * endpoint was down. Without it a customer can be charged and left with a
 * PENDING order that `OrderTimeoutService` then cancels — money taken, no
 * goods.
 *
 * Timing matters: `OrderTimeoutService` cancels PENDING orders at 15 minutes.
 * This job runs every minute over transactions older than 5 minutes, so a
 * missed webhook has roughly a 10-minute window to be recovered before the
 * order is cancelled. Payments that land after that are still detected (the
 * lookback runs to 24h) and are recorded as PAID + refund-required rather than
 * silently ignored.
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  /** Give the customer time to finish the Razorpay modal before we poll. */
  private static readonly MIN_AGE_MINUTES = 5;
  /** Lower bound so the job never re-polls ancient rows forever. */
  private static readonly LOOKBACK_HOURS = 24;
  private static readonly BATCH_SIZE = 50;

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly razorpayProvider: RazorpayProvider,
    private readonly settlementService: PaymentSettlementService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    // The age window is evaluated by Postgres, not in JS. `transactions.created_at`
    // is a `TIMESTAMP` (no time zone) written from the database clock, so binding
    // a JS `Date` here would compare wall-clock values from two different zones
    // whenever the API container is not on UTC — which silently widened the
    // grace period by the offset (an IST container polled brand-new payments).
    const pendingTransactions = await this.transactionRepository
      .createQueryBuilder('transaction')
      .leftJoinAndSelect('transaction.order', 'order')
      .where('transaction.status = :status', { status: TransactionStatus.PENDING })
      .andWhere('transaction.provider = :provider', { provider: PaymentProvider.RAZORPAY })
      // Razorpay is polled by razorpay_order_id, which we store here at checkout.
      // A row without one never reached the gateway, so there is nothing to
      // reconcile against — the timeout job will cancel it.
      .andWhere('transaction.gateway_ref_id IS NOT NULL')
      .andWhere(`transaction.created_at < now() - (:minAge || ' minutes')::interval`, {
        minAge: PaymentReconciliationService.MIN_AGE_MINUTES,
      })
      .andWhere(`transaction.created_at > now() - (:lookback || ' hours')::interval`, {
        lookback: PaymentReconciliationService.LOOKBACK_HOURS,
      })
      .orderBy('transaction.created_at', 'ASC')
      .take(PaymentReconciliationService.BATCH_SIZE)
      .getMany();

    if (pendingTransactions.length === 0) {
      return;
    }

    this.logger.log(`Reconciling ${pendingTransactions.length} pending Razorpay transaction(s)`);

    for (const transaction of pendingTransactions) {
      try {
        await this.reconcileTransaction(transaction);
      } catch (error) {
        // One bad row (or one gateway 5xx) must not stop the batch — the next
        // run picks it up again.
        this.logger.error(`Failed to reconcile transaction ${transaction.id}`, error);
      }
    }
  }

  private async reconcileTransaction(transaction: Transaction) {
    // `gateway_ref_id` is the razorpay_order_id returned by
    // `RazorpayProvider.initiatePayment` and stored by CheckoutService. This is
    // the same lookup `OrdersService.verifyOrder` performs when the storefront
    // polls after the modal closes — one provider method, one meaning.
    const statusResponse = await this.razorpayProvider.getPaymentStatus(transaction.gateway_ref_id);

    this.logger.log(
      `Reconciliation status for transaction ${transaction.id}: ${statusResponse.status}`,
    );

    if (statusResponse.status === ProviderPaymentStatus.SUCCESS) {
      const outcome = await this.settlementService.settleSuccess(transaction.id, {
        reconciliation: statusResponse,
      });
      this.logger.warn(
        `Recovered missed Razorpay payment for transaction ${transaction.id} (outcome: ${outcome})`,
      );
      return;
    }

    if (statusResponse.status === ProviderPaymentStatus.FAILED) {
      await this.settlementService.settleFailure(transaction.id, { reconciliation: statusResponse });
      return;
    }

    // PENDING at the gateway too (Razorpay reports `created` / `attempted`):
    // the customer has not paid. Leave it alone — either they finish and the
    // webhook fires, or OrderTimeoutService cancels the order at 15 minutes and
    // releases the stock reservation.
  }
}
