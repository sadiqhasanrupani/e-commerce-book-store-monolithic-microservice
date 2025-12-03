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

    // 2. Update Transaction and Order Status
    // We need to find the transaction.
    // verification.transactionId should match our gateway_ref_id or we need to look it up.
    // For PhonePe, we sent orderId as merchantTransactionId.
    // For Razorpay, we get razorpay_order_id.

    // In CheckoutService, we saved gateway_ref_id.

    let transaction: Transaction | null = null;

    if (providerEnum === PaymentProvider.PHONEPE) {
      // PhonePe merchantTransactionId is now our Transaction UUID
      const transactionId = verification.transactionId;
      transaction = await this.transactionRepository.findOne({
        where: { id: transactionId },
        relations: ['order', 'order.user']
      });

    } else {
      // Razorpay: transactionId is razorpay_order_id
      transaction = await this.transactionRepository.findOne({
        where: { gateway_ref_id: verification.transactionId },
        relations: ['order', 'order.user']
      });
    }

    if (!transaction) {
      this.logger.error(`Transaction not found for webhook: ${verification.transactionId}`);
      // It might be that we already processed it?
      return { status: 'ignored' };
    }

    if (transaction.status === TransactionStatus.SUCCESS) {
      this.logger.log(`Transaction ${transaction.id} already successful`);
      return { status: 'already_processed' };
    }

    // Update Transaction Status
    if (verification.status === 'SUCCESS') {
      transaction.status = TransactionStatus.SUCCESS;
      transaction.raw_response = { ...transaction.raw_response, webhook: req.body }; // Save webhook body
      await this.transactionRepository.save(transaction);

      // Update Order Status
      const order = transaction.order;
      if (order.payment_status !== PaymentStatus.PAID) {
        order.payment_status = PaymentStatus.PAID;
        await this.orderRepository.save(order);

        // Update Cart
        const cart = await this.cartRepository.findOne({
          where: { userId: order.user.id, status: CartStatus.CHECKOUT }
        });
        if (cart) {
          cart.status = CartStatus.COMPLETED;
          await this.cartRepository.save(cart);
        }
      }
    } else if (verification.status === 'FAILED') {
      transaction.status = TransactionStatus.FAILED;
      transaction.raw_response = { ...transaction.raw_response, webhook: req.body };
      await this.transactionRepository.save(transaction);

      // We don't necessarily fail the order immediately, user might retry.
      // But we can mark it as FAILED if we want.
      // order.payment_status = PaymentStatus.FAILED;
      // await this.orderRepository.save(order);
    }

    return { status: 'processed' };
  }
}
