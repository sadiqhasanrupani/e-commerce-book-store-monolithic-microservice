import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { Order } from '@app/contract/orders/entities/order.entity';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { PaymentStatus as ProviderPaymentStatus } from '../interfaces/payment-provider.interface';
import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';
import { PhonePeProvider } from '../providers/phonepe.provider';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    private readonly phonePeProvider: PhonePeProvider,
  ) { }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    this.logger.log('Running Payment Reconciliation Cron Job');

    // Find PENDING PhonePe transactions older than 5 minutes (to give time for redirection)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const pendingTransactions = await this.transactionRepository.find({
      where: {
        status: TransactionStatus.PENDING,
        provider: PaymentProvider.PHONEPE,
        created_at: LessThan(fiveMinutesAgo),
      },
      relations: ['order', 'order.user'],
      take: 50, // Process in batches
    });

    this.logger.log(`Found ${pendingTransactions.length} pending PhonePe transactions`);

    for (const transaction of pendingTransactions) {
      try {
        await this.reconcileTransaction(transaction);
      } catch (error) {
        this.logger.error(`Failed to reconcile transaction ${transaction.id}`, error);
      }
    }
  }

  private async reconcileTransaction(transaction: Transaction) {
    // Use gateway_ref_id (which is merchantTransactionId for PhonePe)
    // If gateway_ref_id is missing, we might use order id if that's what we sent.
    // In CheckoutService, we set gateway_ref_id = paymentResponse.transactionId which was orderId.

    const transactionIdToCheck = transaction.gateway_ref_id || transaction.order.id.toString();

    const statusResponse = await this.phonePeProvider.getPaymentStatus(transactionIdToCheck);

    this.logger.log(`Reconciliation status for ${transaction.id}: ${statusResponse.status}`);

    if (statusResponse.status === ProviderPaymentStatus.SUCCESS) {
      transaction.status = TransactionStatus.SUCCESS;
      transaction.raw_response = { ...transaction.raw_response, reconciliation: statusResponse };
      await this.transactionRepository.save(transaction);

      const order = transaction.order;
      if (order.payment_status !== PaymentStatus.PAID) {
        order.payment_status = PaymentStatus.PAID;
        await this.orderRepository.save(order);

        const cart = await this.cartRepository.findOne({
          where: { userId: order.user.id, status: CartStatus.CHECKOUT }
        });
        if (cart) {
          cart.status = CartStatus.COMPLETED;
          await this.cartRepository.save(cart);
        }
      }
    } else if (statusResponse.status === ProviderPaymentStatus.FAILED) {
      transaction.status = TransactionStatus.FAILED;
      transaction.raw_response = { ...transaction.raw_response, reconciliation: statusResponse };
      await this.transactionRepository.save(transaction);

      // Mark order as failed? Or leave it pending for retry?
      // If transaction failed, user might retry.
    }
  }
}
