import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

/**
 * Google Pay UPI Payment Provider
 *
 * Integration Guide: https://developers.google.com/pay/india/api/web/googlepay-business
 *
 * Features:
 * - UPI Intent (opens Google Pay app)
 * - Deep linking
 * - Transaction status API
 *
 * Note: Google Pay uses UPI deep links, not a traditional payment gateway API
 * Actual payment processing happens through UPI rails
 */
@Injectable()
export class GooglePayProvider implements IPaymentProvider {
  private readonly logger = new Logger(GooglePayProvider.name);
  private readonly merchantVPA: string;
  private readonly merchantName: string;

  constructor(private readonly configService: ConfigService) {
    this.merchantVPA = this.configService.get<string>('GOOGLEPAY_MERCHANT_VPA') || '';
    this.merchantName = this.configService.get<string>('GOOGLEPAY_MERCHANT_NAME', 'MagicPages');

    if (!this.merchantVPA) {
      this.logger.warn('GooglePay configuration missing (MERCHANT_VPA)');
    }
  }

  getProviderName(): PaymentProvider {
    return PaymentProvider.GOOGLEPAY;
  }

  async initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    this.logger.log(`Initiating GooglePay payment for order ${request.orderId}`);

    // Google Pay uses UPI deep link format
    const upiUrl = this.generateUPIDeepLink({
      pa: this.merchantVPA, // Payee address (VPA)
      pn: this.merchantName, // Payee name
      am: request.amount.toFixed(2), // Amount
      tr: request.orderId, // Transaction reference
      tn: `Payment for order ${request.orderId}`, // Transaction note
      cu: request.currency,
    });

    const response: PaymentInitiationResponse = {
      transactionId: `GPAY_${request.orderId}_${Date.now()}`,
      paymentUrl: upiUrl,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      provider: PaymentProvider.GOOGLEPAY,
      actionType: PaymentActionType.REDIRECT,
    };

    this.logger.log(`GooglePay payment initiated: ${response.transactionId}`);
    return response;
  }

  async verifyWebhook(headers: Record<string, string>, body: any): Promise<WebhookVerificationResult> {
    // Google Pay doesn't have direct webhooks
    // Payment confirmation comes through UPI system
    // You would typically poll the payment status or use a payment aggregator
    this.logger.warn('GooglePay does not support direct webhooks');

    return {
      isValid: false,
      error: 'GooglePay webhooks not supported. Use status polling instead.',
    };
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatusResponse> {
    this.logger.log(`Checking GooglePay payment status for ${transactionId}`);

    // In production, you would:
    // 1. Query your bank's UPI transaction API
    // 2. Or use a payment aggregator like Razorpay/Cashfree
    // 3. Or check your merchant account dashboard

    // Mock response
    return {
      transactionId,
      status: PaymentStatus.PENDING,
      amount: 0,
    };
  }

  async initiateRefund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(`Initiating GooglePay refund for ${request.transactionId}`);

    // Refunds for UPI payments are typically handled through:
    // 1. Bank's merchant portal
    // 2. Payment aggregator API
    // 3. Manual bank transfer

    return {
      refundId: `REFUND_${request.transactionId}_${Date.now()}`,
      status: 'INITIATED',
    };
  }

  supportsFeature(feature: 'QR_CODE' | 'INTENT' | 'RECURRING' | 'INTERNATIONAL'): boolean {
    const supportedFeatures = {
      QR_CODE: true,
      INTENT: true,
      RECURRING: false,
      INTERNATIONAL: false,
    };
    return supportedFeatures[feature] || false;
  }

  /**
   * Generate UPI deep link for Google Pay
   * Format: upi://pay?pa=<VPA>&pn=<Name>&am=<Amount>&tr=<TxnRef>&tn=<Note>&cu=<Currency>
   */
  private generateUPIDeepLink(params: {
    pa: string;
    pn: string;
    am: string;
    tr: string;
    tn: string;
    cu: string;
  }): string {
    const queryParams = new URLSearchParams({
      pa: params.pa,
      pn: params.pn,
      am: params.am,
      tr: params.tr,
      tn: params.tn,
      cu: params.cu,
    });

    return `upi://pay?${queryParams.toString()}`;
  }
}
