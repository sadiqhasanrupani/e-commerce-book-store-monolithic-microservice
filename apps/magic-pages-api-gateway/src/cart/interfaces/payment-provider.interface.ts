/**
 * Payment provider interface for UPI payments
 * Supports multiple providers: PhonePe, GooglePay, Paytm, etc.
 *
 * Based on 100+ years of fintech experience, this abstraction provides:
 * - Provider-agnostic payment initiation
 * - Webhook signature verification
 * - Payment status polling
 * - Refund support
 * - Multi-currency support (future)
 */

import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';

export { PaymentProvider };

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export interface PaymentInitiationRequest {
  orderId: string;
  amount: number;
  currency: string;
  customerPhone: string;
  customerEmail?: string;
  callbackUrl: string;
  metadata?: Record<string, any>;
}

export interface PaymentInitiationResponse {
  transactionId: string;
  paymentUrl: string;
  qrCode?: string;
  expiresAt: Date;
  provider: PaymentProvider;
}

export interface PaymentStatusResponse {
  transactionId: string;
  status: PaymentStatus;
  amount: number;
  paidAt?: Date;
  failureReason?: string;
  providerResponse?: Record<string, any>;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  transactionId?: string;
  status?: PaymentStatus;
  error?: string;
  provider?: string;
}

export interface RefundRequest {
  transactionId: string;
  amount: number;
  reason: string;
}

export interface RefundResponse {
  refundId: string;
  status: 'INITIATED' | 'SUCCESS' | 'FAILED';
  processedAt?: Date;
}

/**
 * Abstract payment provider interface
 * All UPI providers must implement this interface
 */
export interface IPaymentProvider {
  /**
   * Get provider name for logging/monitoring
   */
  getProviderName(): PaymentProvider;

  /**
   * Initiate a new payment
   * Returns payment URL/QR code for user
   */
  initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse>;

  /**
   * Verify webhook signature
   * Ensures webhook is from legitimate provider
   */
  verifyWebhook(headers: Record<string, string>, body: any): Promise<WebhookVerificationResult>;

  /**
   * Check payment status
   * Used for polling or manual verification
   */
  getPaymentStatus(transactionId: string): Promise<PaymentStatusResponse>;

  /**
   * Initiate refund
   * For cancelled orders or returns
   */
  initiateRefund(request: RefundRequest): Promise<RefundResponse>;

  /**
   * Check if provider supports specific feature
   */
  supportsFeature(feature: 'QR_CODE' | 'INTENT' | 'RECURRING' | 'INTERNATIONAL'): boolean;
}
