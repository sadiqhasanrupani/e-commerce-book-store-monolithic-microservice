import {
  Controller,
  Post,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentProvider } from './interfaces/payment-provider.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { CartMetricsService } from './metrics/cart-metrics.service';
import { Repository } from 'typeorm';
import { RazorpayProvider } from './providers/razorpay.provider';
import { Transaction } from '@app/contract/orders/entities/transaction.entity';
import { PaymentSettlementService, SettlementOutcome } from './services/payment-settlement.service';

@ApiTags('Payment Webhooks')
@Controller('cart/webhook')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly razorpayProvider: RazorpayProvider,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly settlementService: PaymentSettlementService,
    private readonly metricsService: CartMetricsService,
  ) {}

  @Post('payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Razorpay payment webhook' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(@Req() req: any, @Headers() headers: Record<string, string>) {
    this.logger.log('Received payment webhook');

    // Razorpay is the only gateway we accept (roadmap #6). Anything without an
    // `X-Razorpay-Signature` is rejected outright rather than guessed at.
    if (!headers['x-razorpay-signature']) {
      this.logger.warn('Rejected webhook without a Razorpay signature header');
      throw new BadRequestException('Unknown provider');
    }

    // 1. Verify signature using the RAW body
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('Raw body missing for webhook verification');
      throw new BadRequestException('Raw body missing');
    }

    const verification = await this.razorpayProvider.verifyWebhook(headers, rawBody);

    if (!verification.isValid) {
      this.logger.warn(`Invalid webhook signature: ${verification.error}`);
      this.metricsService.incrementPaymentWebhook('invalid_signature', PaymentProvider.RAZORPAY);
      throw new BadRequestException('Invalid signature');
    }

    this.logger.log(
      `Webhook verified for gateway ref: ${verification.transactionId}, status: ${verification.status}`,
    );
    this.metricsService.incrementPaymentWebhook(
      verification.status === 'SUCCESS' ? 'success' : verification.status === 'FAILED' ? 'failed' : 'pending',
      PaymentProvider.RAZORPAY,
    );

    if (!verification.status || !verification.transactionId) {
      // Informational event (refund.*, order.paid, …) — verified but nothing to settle.
      return { status: 'ignored' };
    }

    // 2. Map the gateway reference (razorpay_order_id) back to our transaction.
    const transaction = await this.transactionRepository.findOne({
      where: { gateway_ref_id: verification.transactionId },
      select: { id: true },
    });

    if (!transaction) {
      this.logger.error(`Transaction not found for webhook gateway ref: ${verification.transactionId}`);
      return { status: 'ignored' };
    }

    // 3. Apply the result. Shared with the reconciliation cron so a missed
    //    webhook settles exactly the same way (see PaymentSettlementService).
    const outcome =
      verification.status === 'SUCCESS'
        ? await this.settlementService.settleSuccess(transaction.id, { webhook: req.body })
        : verification.status === 'FAILED'
          ? await this.settlementService.settleFailure(transaction.id, { webhook: req.body })
          : SettlementOutcome.IGNORED;

    return { status: outcome };
  }
}
