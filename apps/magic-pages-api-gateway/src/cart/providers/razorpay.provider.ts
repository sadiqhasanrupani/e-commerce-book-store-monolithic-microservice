import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay = require('razorpay');
import * as crypto from 'crypto';
import {
  IPaymentProvider,
  PaymentProvider,
  PaymentInitiationRequest,
  PaymentInitiationResponse,
  PaymentStatusResponse,
  WebhookVerificationResult,
  RefundRequest,
  RefundResponse,
  PaymentStatus,
  PaymentActionType,
} from '../interfaces/payment-provider.interface';

@Injectable()
export class RazorpayProvider implements IPaymentProvider {
  private readonly logger = new Logger(RazorpayProvider.name);
  private readonly razorpay: Razorpay;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');
    this.webhookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET') || '';

    if (!keyId || !keySecret) {
      this.logger.warn('Razorpay configuration missing (KEY_ID or KEY_SECRET)');
    }

    this.razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  getProviderName(): PaymentProvider {
    return PaymentProvider.RAZORPAY;
  }

  async initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    this.logger.log(`Initiating Razorpay payment for order ${request.orderId}`);

    try {
      const options = {
        amount: Math.round(request.amount * 100), // Amount in paise
        currency: request.currency,
        receipt: request.orderId,
        notes: {
          ...request.metadata,
          orderId: request.orderId,
        },
      };

      const order = await this.razorpay.orders.create(options);

      return {
        transactionId: order.id, // This is the razorpay_order_id
        orderId: order.id,
        provider: PaymentProvider.RAZORPAY,
        actionType: PaymentActionType.MODAL,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins (approx)
      };
    } catch (error) {
      this.logger.error('Razorpay payment initiation failed', error);
      throw new Error(`Razorpay initiation failed: ${error.message}`);
    }
  }

  async verifyWebhook(headers: Record<string, string>, body: any): Promise<WebhookVerificationResult> {
    const signature = headers['x-razorpay-signature'];

    if (!signature) {
      return { isValid: false, error: 'Missing signature' };
    }

    // Razorpay webhook verification
    // We need the raw body here. The controller must pass the raw body buffer or string.
    // If 'body' is already parsed JSON, this verification will fail if we don't have the raw string.
    // Assuming 'body' passed here is the RAW BODY (Buffer or string) as per instructions.

    // However, the controller might receive parsed JSON if not configured correctly.
    // The instruction said: "NestJS Config: You must ensure your controller receives the raw request body".
    // So I will assume `body` is the raw buffer/string.

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(body)
        .digest('hex');

      if (expectedSignature !== signature) {
        return { isValid: false, error: 'Invalid signature' };
      }

      // Parse body now
      const payload = JSON.parse(body.toString());
      const event = payload.event;
      const payloadData = payload.payload;

      let status: PaymentStatus | undefined;
      let transactionId: string | undefined;

      if (event === 'payment.captured') {
        status = PaymentStatus.SUCCESS;
        transactionId = payloadData.payment.entity.order_id; // Map back to our order via razorpay_order_id
      } else if (event === 'payment.failed') {
        status = PaymentStatus.FAILED;
        transactionId = payloadData.payment.entity.order_id;
      } else {
        // Other events
        return { isValid: true, status: undefined, provider: 'RAZORPAY' };
      }

      return {
        isValid: true,
        transactionId,
        status,
        provider: 'RAZORPAY',
      };
    } catch (error) {
      this.logger.error('Razorpay webhook verification failed', error);
      return { isValid: false, error: error.message };
    }
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatusResponse> {
    // transactionId here is the Razorpay Order ID (gateway_ref_id)
    try {
      const order = await this.razorpay.orders.fetch(transactionId);

      let status = PaymentStatus.PENDING;
      if (order.status === 'paid') {
        status = PaymentStatus.SUCCESS;
      } else if (order.status === 'attempted') {
        // 'attempted' means user clicked pay but maybe didn't complete, or failed.
        // We keep it PENDING until we get a definitive success/failure or timeout.
        status = PaymentStatus.PENDING;
      }

      return {
        transactionId,
        status,
        amount: Number(order.amount) / 100,
        providerResponse: order,
      };
    } catch (error) {
      this.logger.error(`Razorpay status check failed for ${transactionId}`, error);
      throw new InternalServerErrorException(`Status check failed: ${error.message}`);
    }
  }

  async initiateRefund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(`Initiating Razorpay refund for Order ID: ${request.transactionId}`);

    try {
      // 1. Fetch all payments associated with this Razorpay Order ID
      const payments = await this.razorpay.orders.fetchPayments(request.transactionId);

      // 2. Find the successfully captured payment to refund
      // In a standard flow, there should be only one 'captured' payment per order.
      const successfulPayment = payments.items.find(p => p.status === 'captured');

      if (!successfulPayment) {
        this.logger.warn(`No captured payment found for Razorpay Order ${request.transactionId}`);
        throw new BadRequestException('No captured payment found for this order');
      }

      // 3. Initiate Refund on the Payment ID
      const refund = await this.razorpay.payments.refund(successfulPayment.id, {
        amount: Math.round(request.amount * 100), // Amount in paise
        notes: {
          reason: request.reason,
          merchant_order_id: request.transactionId
        }
      });

      this.logger.log(`Refund initiated: ${refund.id} for Payment: ${successfulPayment.id}`);

      return {
        refundId: refund.id,
        status: 'INITIATED', // Razorpay refunds are processed asynchronously but ID is immediate
        processedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Razorpay refund failed: ${error.message}`, error);
      // Map Razorpay errors to standard exceptions if needed
      throw new InternalServerErrorException(`Refund failed: ${error.error?.description || error.message}`);
    }
  }

  supportsFeature(feature: 'QR_CODE' | 'INTENT' | 'RECURRING' | 'INTERNATIONAL'): boolean {
    const supported = {
      QR_CODE: false,
      INTENT: false,
      RECURRING: true,
      INTERNATIONAL: true,
    };
    return supported[feature] || false;
  }
}
