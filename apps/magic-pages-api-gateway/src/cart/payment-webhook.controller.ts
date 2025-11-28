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
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IPaymentProvider } from './interfaces/payment-provider.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from '@app/contract/orders/entities/order.entity';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { CartMetricsService } from './metrics/cart-metrics.service';
import { Repository } from 'typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';

@ApiTags('Payment Webhooks')
@Controller('cart/webhook')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    @Inject('PAYMENT_PROVIDER')
    private readonly paymentProvider: IPaymentProvider,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    private readonly metricsService: CartMetricsService,
  ) { }

  @Post('payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle payment provider webhook' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(@Body() body: any, @Headers() headers: Record<string, string>) {
    this.logger.log('Received payment webhook');

    // 1. Verify Signature
    const verification = await this.paymentProvider.verifyWebhook(headers, body);

    if (!verification.isValid) {
      this.logger.warn(`Invalid webhook signature: ${verification.error}`);
      this.metricsService.incrementPaymentWebhook('invalid_signature', 'unknown');
      throw new BadRequestException('Invalid signature');
    }

    this.logger.log(`Webhook verified for transactionId: ${verification.transactionId}, status: ${verification.status}`);
    this.metricsService.incrementPaymentWebhook(
      verification.status === 'SUCCESS' ? 'success' : verification.status === 'FAILED' ? 'failed' : 'pending',
      verification.provider || 'unknown'
    );

    // 2. Update Order Status
    // Assuming transactionId format is PROVIDER_ORDERID_TIMESTAMP
    // We need to extract orderId. Or we can store transactionId in Order entity.
    // For now, let's assume verification.transactionId maps to something we can find.
    // Ideally, we should have stored transactionId in Order when initiating payment.
    // But since we didn't add transactionId column to Order yet, let's try to parse it or find by ID if possible.

    if (!verification.transactionId) {
      this.logger.error('Transaction ID missing in verification result');
      return { status: 'ignored' };
    }

    // Hack: Parse orderId from transactionId string "PROVIDER_ORDERID_TIMESTAMP"
    const parts = verification.transactionId.split('_');
    const orderId = parts[1]; // Assuming 2nd part is orderId

    if (!orderId) {
      this.logger.error(`Could not extract orderId from transactionId: ${verification.transactionId}`);
      return { status: 'ignored' };
    }

    const order = await this.orderRepository.findOne({ where: { id: Number(orderId) }, relations: ['user'] });

    if (!order) {
      this.logger.error(`Order not found for webhook: ${orderId}`);
      return { status: 'ignored' };
    }

    if (order.payment_status === PaymentStatus.PAID) {
      this.logger.log(`Order ${orderId} already paid`);
      return { status: 'already_processed' };
    }

    // Map Provider Status to Order Status
    // Provider Status: SUCCESS, FAILED, PENDING
    // Order Status: PAID, FAILED, PENDING

    if (verification.status === 'SUCCESS') {
      order.payment_status = PaymentStatus.PAID;
      await this.orderRepository.save(order);

      // 3. Update Cart Status to COMPLETED
      // We need to find the cart associated with this order.
      // We passed cartId in metadata during payment initiation.
      // But webhook body might not have metadata depending on provider.
      // Alternatively, we can find the cart for this user that is in CHECKOUT status.

      const cart = await this.cartRepository.findOne({
        where: {
          userId: order.user.id,
          status: CartStatus.CHECKOUT,
        },
      });

      if (cart) {
        cart.status = CartStatus.COMPLETED;
        await this.cartRepository.save(cart);
        this.logger.log(`Cart ${cart.id} marked as COMPLETED`);
      }
    } else if (verification.status === 'FAILED') {
      order.payment_status = PaymentStatus.FAILED;
      await this.orderRepository.save(order);

      const cart = await this.cartRepository.findOne({
        where: {
          userId: order.user.id,
          status: CartStatus.CHECKOUT,
        },
      });

      if (cart) {
        cart.status = CartStatus.ABANDONED;
        await this.cartRepository.save(cart);
        this.logger.log(`Cart ${cart.id} marked as ABANDONED`);
      }
    }

    return { status: 'processed' };
  }
}
