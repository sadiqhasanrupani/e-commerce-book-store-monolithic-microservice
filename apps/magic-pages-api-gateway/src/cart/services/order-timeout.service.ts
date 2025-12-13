import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Order } from '@app/contract/orders/entities/order.entity';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';

@Injectable()
export class OrderTimeoutService {
  private readonly logger = new Logger(OrderTimeoutService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(BookFormatVariant)
    private readonly variantRepository: Repository<BookFormatVariant>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
  ) { }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async cancelPendingOrders() {
    this.logger.log('Running order timeout job...');
    const thresholdDate = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago

    const timedOutOrders = await this.orderRepository.find({
      where: {
        created_at: LessThan(thresholdDate),
        payment_status: PaymentStatus.PENDING,
      },
      relations: ['items', 'items.bookFormatVariant', 'transactions'],
    });

    if (timedOutOrders.length === 0) {
      return;
    }

    this.logger.log(`Found ${timedOutOrders.length} stale orders to cancel.`);

    for (const order of timedOutOrders) {
      try {
        // Double check payment status (optimistic check)
        if (order.payment_status !== PaymentStatus.PENDING) continue;

        // Cancel Transactions
        // If there are transactions, mark them as FAILED or CANCELLED?
        // Let's mark transactions as FAILED if they are PENDING
        for (const txn of order.transactions) {
          if (txn.status === TransactionStatus.PENDING) {
            txn.status = TransactionStatus.FAILED;
            await this.transactionRepository.save(txn);
          }
        }

        // Cancel Order
        order.payment_status = PaymentStatus.FAILED;
        // order.fulfillment_status = FulfillmentStatus.CANCELLED; // Consider adding this if imported
        await this.orderRepository.save(order);

        // Release Stock Reservations
        for (const item of order.items) {
          if (item.bookFormatVariant) {
            // Decrement reservedQuantity
            // Note: We do NOT decrement stockQuantity because it was never deducted (2-Phase Commit)
            await this.variantRepository.decrement({ id: item.bookFormatVariant.id }, 'reservedQuantity', item.quantity);
            this.logger.log(`Released stock for Order ${order.id} Item ${item.id}`);
          }
        }

        this.logger.log(`Cancelled Order ${order.id} due to timeout.`);

      } catch (error) {
        this.logger.error(`Failed to cancel order ${order.id}`, error);
      }
    }
  }
}
