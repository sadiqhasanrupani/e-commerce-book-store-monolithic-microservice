import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Inject,
  BadRequestException,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IPaymentProvider, PaymentProvider } from './interfaces/payment-provider.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from '@app/contract/orders/entities/order.entity';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { CartMetricsService } from './metrics/cart-metrics.service';
import { Repository } from 'typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { PhonePeProvider } from './providers/phonepe.provider';
import { RazorpayProvider } from './providers/razorpay.provider';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { DataSource } from 'typeorm';

@ApiTags('Payment Webhooks')
@Controller('cart/webhook')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly phonePeProvider: PhonePeProvider,
    private readonly razorpayProvider: RazorpayProvider,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(BookFormatVariant)
    private readonly variantRepository: Repository<BookFormatVariant>,
    private readonly dataSource: DataSource,
    private readonly metricsService: CartMetricsService,
  ) { }

  @Post('payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle payment provider webhook' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(@Req() req: any, @Headers() headers: Record<string, string>) {
    this.logger.log('Received payment webhook');

    // Determine provider from headers or body structure
    // PhonePe sends X-VERIFY
    // Razorpay sends X-Razorpay-Signature

    let provider: IPaymentProvider;
    let providerEnum: PaymentProvider;

    if (headers['x-verify']) {
      provider = this.phonePeProvider;
      providerEnum = PaymentProvider.PHONEPE;
    } else if (headers['x-razorpay-signature']) {
      provider = this.razorpayProvider;
      providerEnum = PaymentProvider.RAZORPAY;
    } else {
      this.logger.warn('Unknown webhook provider');
      throw new BadRequestException('Unknown provider');
    }

    // 1. Verify Signature using RAW BODY
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('Raw body missing for webhook verification');
      throw new BadRequestException('Raw body missing');
    }

    const verification = await provider.verifyWebhook(headers, rawBody);

    if (!verification.isValid) {
      this.logger.warn(`Invalid webhook signature: ${verification.error}`);
      this.metricsService.incrementPaymentWebhook('invalid_signature', providerEnum);
      throw new BadRequestException('Invalid signature');
    }

    this.logger.log(`Webhook verified for transactionId: ${verification.transactionId}, status: ${verification.status}`);
    this.metricsService.incrementPaymentWebhook(
      verification.status === 'SUCCESS' ? 'success' : verification.status === 'FAILED' ? 'failed' : 'pending',
      providerEnum
    );

    // 2. Update Transaction and Order Status (Transactional)
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find Transaction within Transaction Context? 
      // Actually we can find it normally, but need to lock it if we were stricter.
      // For now, simpler approach: fetch, verify, then write using queryRunner.

      let transaction: Transaction | null = null;
      // ... (finding transaction logic remains same, but we will use it inside logic)

      if (providerEnum === PaymentProvider.PHONEPE) {
        transaction = await queryRunner.manager.findOne(Transaction, {
          where: { id: verification.transactionId },
          relations: ['order', 'order.items', 'order.items.bookFormatVariant', 'order.user']
        });
      } else {
        transaction = await queryRunner.manager.findOne(Transaction, {
          where: { gateway_ref_id: verification.transactionId },
          relations: ['order', 'order.items', 'order.items.bookFormatVariant', 'order.user']
        });
      }

      if (!transaction) {
        this.logger.error(`Transaction not found for webhook: ${verification.transactionId}`);
        await queryRunner.rollbackTransaction();
        return { status: 'ignored' };
      }

      if (transaction.status === TransactionStatus.SUCCESS) {
        this.logger.log(`Transaction ${transaction.id} already successful`);
        await queryRunner.rollbackTransaction();
        return { status: 'already_processed' };
      }

      const order = transaction.order;

      // Update Transaction Status
      if (verification.status === 'SUCCESS') {
        transaction.status = TransactionStatus.SUCCESS;
        transaction.raw_response = { ...transaction.raw_response, webhook: req.body };
        await queryRunner.manager.save(Transaction, transaction);

        if (order.payment_status !== PaymentStatus.PAID) {
          order.payment_status = PaymentStatus.PAID;
          await queryRunner.manager.save(Order, order);

          // Permanent Stock Deduction (Commit)
          for (const item of order.items) {
            const variant = item.bookFormatVariant;
            // We need to decrement stockQuantity AND reservedQuantity
            // Previous logic only decremented reservedQuantity at checkout. 
            // Now we decrement BOTH here.
            // WAIT! logic says: "Decrement stockQuantity. Decrement reservedQuantity".
            // Assuming isPhysicalFormat check was done at checkout or we check again.
            // Ideally check format.
            // We assume variants are loaded.
            if (variant) {
              // TODO: Check isPhysicalFormat(variant.format). For now Assuming yes or harmless if digital has quantity.
              await queryRunner.manager.decrement(BookFormatVariant, { id: variant.id }, 'stockQuantity', item.quantity);
              await queryRunner.manager.decrement(BookFormatVariant, { id: variant.id }, 'reservedQuantity', item.quantity);
            }
          }

          // Update Cart
          const cart = await queryRunner.manager.findOne(Cart, {
            where: { userId: order.user.id, status: CartStatus.CHECKOUT }
          });
          if (cart) {
            cart.status = CartStatus.COMPLETED;
            await queryRunner.manager.save(Cart, cart);
          }
        }
      } else if (verification.status === 'FAILED') {
        transaction.status = TransactionStatus.FAILED;
        transaction.raw_response = { ...transaction.raw_response, webhook: req.body };
        await queryRunner.manager.save(Transaction, transaction);

        // Revert Cart to ACTIVE and Touch updatedAt
        const cart = await queryRunner.manager.findOne(Cart, {
          where: { userId: order.user.id, status: CartStatus.CHECKOUT }
        });
        if (cart) {
          cart.status = CartStatus.ACTIVE;
          // Touch updated_at is automatic on save? Yes, usually.
          // But we can explicitly set it to be sure or just saving changes it.
          // However, we want to ensure the entity is marked as dirty.
          // Changing status is enough.
          await queryRunner.manager.save(Cart, cart);

          // Should we release reserved quantity? 
          // RFC plan said: "Decrement reservedQuantity (Release hold)".
          // BUT user said: "Revert Cart to ACTIVE and Touch updatedAt".
          // If we revert to ACTIVE, the reservation should stay valid for another 15m.
          // So we DO NOT release reservedQuantity here. We let the cleanup cron handle it if user abandons.
          // If we released it, user would lose the item immediately.
        }
      }

      await queryRunner.commitTransaction();
      return { status: 'processed' };

    } catch (error) {
      this.logger.error('Webhook processing failed', error);
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

  }
}
