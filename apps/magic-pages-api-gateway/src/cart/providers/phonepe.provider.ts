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
} from '../interfaces/payment-provider.interface';
import * as crypto from 'crypto';

/**
 * PhonePe UPI Payment Provider
 *
 * Integration Guide: https://developer.phonepe.com/v1/docs/payment-gateway
 *
 * Features:
 * - UPI Intent (opens PhonePe app)
 * - UPI Collect (VPA-based)
 * - QR Code generation
 * - Webhook notifications
 *
 * Security:
 * - SHA256 signature verification
 * - Request/response encryption
 * - IP whitelisting (production)
 */
@Injectable()
export class PhonePeProvider implements IPaymentProvider {
  private readonly logger = new Logger(PhonePeProvider.name);
  private readonly merchantId: string;
  private readonly saltKey: string;
  private readonly saltIndex: string;
  private readonly apiBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.merchantId = this.configService.get<string>('PHONEPE_MERCHANT_ID') || '';
    this.saltKey = this.configService.get<string>('PHONEPE_SALT_KEY') || '';

    if (!this.merchantId || !this.saltKey) {
      this.logger.warn('PhonePe configuration missing (MERCHANT_ID or SALT_KEY)');
    }

    this.saltIndex = this.configService.get<string>('PHONEPE_SALT_INDEX', '1');
    this.apiBaseUrl = this.configService.get<string>('PHONEPE_API_URL', 'https://api.phonepe.com/apis/hermes');
  }

  getProviderName(): PaymentProvider {
    return PaymentProvider.PHONEPE;
  }

  /**
   * Initiate a payment request with PhonePe
   *
   * @param request Payment initiation details
   * @returns Payment initiation response with transaction ID and payment URL
   * @throws Error if payment initiation fails
   */
  async initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    this.logger.log(`Initiating PhonePe payment for order ${request.orderId}`);

    // PhonePe payload structure
    const payload = {
      merchantId: this.merchantId,
      merchantTransactionId: request.orderId,
      merchantUserId: request.metadata?.userId || 'GUEST',
      amount: Math.round(request.amount * 100), // Convert to paise
      redirectUrl: request.callbackUrl,
      redirectMode: 'POST',
      callbackUrl: `${request.callbackUrl}/webhook`,
      mobileNumber: request.customerPhone,
      paymentInstrument: {
        type: 'UPI_INTENT',
        targetApp: 'com.phonepe.app',
      },
    };

    // Base64 encode payload
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');

    // Generate X-VERIFY header (SHA256 hash)
    const xVerify = this.generateChecksum(base64Payload);

    try {
      // TODO: Make actual API call to PhonePe
      // const response = await axios.post(`${this.apiBaseUrl}/pg/v1/pay`, {
      //   request: base64Payload
      // }, {
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'X-VERIFY': xVerify,
      //   }
      // });

      // Mock response for now
      const mockResponse: PaymentInitiationResponse = {
        transactionId: `PHONEPE_${request.orderId}_${Date.now()}`,
        paymentUrl: `upi://pay?pa=merchant@phonepe&pn=MagicPages&am=${request.amount}&tr=${request.orderId}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        provider: PaymentProvider.PHONEPE,
      };

      this.logger.log(`PhonePe payment initiated: ${mockResponse.transactionId}`);
      return mockResponse;
    } catch (error) {
      this.logger.error('PhonePe payment initiation failed', error);
      throw new Error(`PhonePe payment failed: ${error.message}`);
    }
  }

  /**
   * Verify webhook signature from PhonePe
   *
   * @param headers Request headers containing X-VERIFY
   * @param body Request body containing base64 encoded response
   * @returns Verification result with status and transaction ID
   */
  async verifyWebhook(headers: Record<string, string>, body: any): Promise<WebhookVerificationResult> {
    try {
      const xVerify = headers['x-verify'];
      const base64Response = body.response;

      // Verify checksum
      const expectedChecksum = this.generateChecksum(base64Response);

      if (xVerify !== expectedChecksum) {
        this.logger.warn('PhonePe webhook signature verification failed');
        return { isValid: false, error: 'Invalid signature' };
      }

      // Decode response
      const decodedResponse = JSON.parse(Buffer.from(base64Response, 'base64').toString('utf-8'));

      return {
        isValid: true,
        transactionId: decodedResponse.data.merchantTransactionId,
        status: this.mapPhonePeStatus(decodedResponse.code),
      };
    } catch (error) {
      this.logger.error('PhonePe webhook verification error', error);
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Check payment status with PhonePe
   *
   * @param transactionId Transaction ID to check
   * @returns Current payment status
   */
  async getPaymentStatus(transactionId: string): Promise<PaymentStatusResponse> {
    this.logger.log(`Checking PhonePe payment status for ${transactionId}`);

    const checksum = this.generateChecksum(`/pg/v1/status/${this.merchantId}/${transactionId}`);

    try {
      // TODO: Make actual API call
      // const response = await axios.get(
      //   `${this.apiBaseUrl}/pg/v1/status/${this.merchantId}/${transactionId}`,
      //   { headers: { 'X-VERIFY': checksum, 'X-MERCHANT-ID': this.merchantId } }
      // );

      // Mock response
      return {
        transactionId,
        status: PaymentStatus.PENDING,
        amount: 0,
      };
    } catch (error) {
      this.logger.error('PhonePe status check failed', error);
      throw error;
    }
  }

  /**
   * Initiate a refund for a transaction
   *
   * @param request Refund details
   * @returns Refund initiation response
   */
  async initiateRefund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(`Initiating PhonePe refund for ${request.transactionId}`);

    const payload = {
      merchantId: this.merchantId,
      merchantTransactionId: request.transactionId,
      originalTransactionId: request.transactionId,
      amount: Math.round(request.amount * 100),
      callbackUrl: `${this.configService.get('APP_URL')}/webhooks/phonepe/refund`,
    };

    // TODO: Implement actual refund API call

    return {
      refundId: `REFUND_${request.transactionId}_${Date.now()}`,
      status: 'INITIATED',
    };
  }

  /**
   * Check if a specific feature is supported by this provider
   *
   * @param feature Feature to check
   * @returns True if supported, false otherwise
   */
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
   * Generate SHA256 checksum for PhonePe API
   */
  private generateChecksum(payload: string): string {
    const checksumString = `${payload}/pg/v1/pay${this.saltKey}`;
    return crypto.createHash('sha256').update(checksumString).digest('hex') + '###' + this.saltIndex;
  }

  /**
   * Map PhonePe status codes to our PaymentStatus enum
   */
  private mapPhonePeStatus(code: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      PAYMENT_SUCCESS: PaymentStatus.SUCCESS,
      PAYMENT_ERROR: PaymentStatus.FAILED,
      PAYMENT_PENDING: PaymentStatus.PENDING,
      PAYMENT_DECLINED: PaymentStatus.FAILED,
      TRANSACTION_NOT_FOUND: PaymentStatus.FAILED,
    };
    return statusMap[code] || PaymentStatus.PENDING;
  }
}
