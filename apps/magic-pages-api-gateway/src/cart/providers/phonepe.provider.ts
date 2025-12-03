import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IPaymentProvider,
  PaymentInitiationRequest,
  PaymentInitiationResponse,
  PaymentProvider,
  WebhookVerificationResult as PaymentVerificationResult,
  PaymentActionType,
  PaymentStatus,
  PaymentStatusResponse,
  RefundRequest,
  RefundResponse,
} from '../interfaces/payment-provider.interface';
import * as crypto from 'crypto';
import axios from 'axios';

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
    this.saltIndex = this.configService.get<string>('PHONEPE_SALT_INDEX', '1');

    // Determine environment
    const env = this.configService.get<string>('NODE_ENV');
    const isProd = env === 'production';
    this.apiBaseUrl = isProd
      ? 'https://api.phonepe.com/apis/hermes'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

    if (!this.merchantId || !this.saltKey) {
      this.logger.warn('PhonePe configuration missing (MERCHANT_ID or SALT_KEY)');
    }
  }

  getProviderName(): PaymentProvider {
    return PaymentProvider.PHONEPE;
  }

  async initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
    this.logger.log(`Initiating PhonePe payment for order ${request.orderId}`);

    const payload = {
      merchantId: this.merchantId,
      merchantTransactionId: request.orderId,
      merchantUserId: request.metadata?.userId?.toString() || 'GUEST',
      amount: request.amount * 100, // Amount in paise
      redirectUrl: request.redirectUrl || request.callbackUrl, // Fallback to callback if no redirect provided
      redirectMode: 'REDIRECT', // PhonePe will POST to this URL. Frontend needs to handle POST or we use GET?
      // If we use POST, the frontend will receive form data. React router doesn't handle POST.
      // Better to use 'REDIRECT' (GET) or 'POST' to a backend proxy that redirects.
      // Standard PhonePe flow often uses POST. Let's check if we can use GET.
      // PhonePe docs say: redirectMode: "REDIRECT" (GET) or "POST".
      // Let's change to REDIRECT (GET) for easier frontend handling.
      callbackUrl: request.callbackUrl,
      mobileNumber: request.customerPhone,
      paymentInstrument: {
        type: 'PAY_PAGE',
      },
    };

    // Manual Hashing for verification
    // SHA256(Base64_Payload + "/pg/v1/pay" + SALT_KEY) + "###" + SALT_INDEX
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const apiEndpoint = '/pg/v1/pay';
    const checksum = this.generateChecksum(base64Payload, apiEndpoint);

    try {
      const response = await axios.post(
        `${this.apiBaseUrl}${apiEndpoint}`,
        {
          request: base64Payload,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': checksum,
          },
        },
      );

      const data = response.data;
      if (data.success) {
        const redirectUrl = data.data.instrumentResponse.redirectInfo.url;
        return {
          transactionId: request.orderId,
          paymentUrl: redirectUrl,
          provider: PaymentProvider.PHONEPE,
          actionType: PaymentActionType.REDIRECT,
        };
      } else {
        throw new InternalServerErrorException(`PhonePe API Error: ${data.message}`);
      }
    } catch (error) {
      this.logger.error(`PhonePe payment initiation failed: ${error.message}`, error.response?.data);
      throw new InternalServerErrorException('Payment initiation failed');
    }
  }

  async verifyWebhook(headers: Record<string, string>, body: any): Promise<PaymentVerificationResult> {
    const xVerify = headers['x-verify'];
    if (!xVerify) {
      return { isValid: false, error: 'Missing X-VERIFY header' };
    }

    let rawBodyString: string;
    if (Buffer.isBuffer(body)) {
      rawBodyString = body.toString('utf8');
    } else if (typeof body === 'string') {
      rawBodyString = body;
    } else {
      return { isValid: false, error: 'Invalid body format for verification' };
    }

    const calculatedChecksum = crypto
      .createHash('sha256')
      .update(rawBodyString + this.saltKey)
      .digest('hex') + '###' + this.saltIndex;

    if (calculatedChecksum !== xVerify) {
      return { isValid: false, error: 'Checksum mismatch' };
    }

    const parsedBody = JSON.parse(rawBodyString);

    let data: any;
    if (parsedBody.response) {
      const decoded = Buffer.from(parsedBody.response, 'base64').toString('utf8');
      data = JSON.parse(decoded);
    } else {
      data = parsedBody;
    }

    const status = data.code === 'PAYMENT_SUCCESS' ? PaymentStatus.SUCCESS : data.code === 'PAYMENT_ERROR' ? PaymentStatus.FAILED : PaymentStatus.PENDING;
    const transactionId = data.data.merchantTransactionId;

    return {
      isValid: true,
      transactionId,
      status,
      provider: PaymentProvider.PHONEPE,
    };
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatusResponse> {
    const apiEndpoint = `/pg/v1/status/${this.merchantId}/${transactionId}`;

    const statusChecksum = crypto
      .createHash('sha256')
      .update(apiEndpoint + this.saltKey)
      .digest('hex') + '###' + this.saltIndex;

    try {
      const response = await axios.get(`${this.apiBaseUrl}${apiEndpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': statusChecksum,
          'X-MERCHANT-ID': this.merchantId,
        },
      });

      const data = response.data;
      if (data.success) {
        const status = data.code === 'PAYMENT_SUCCESS' ? PaymentStatus.SUCCESS : data.code === 'PAYMENT_ERROR' ? PaymentStatus.FAILED : PaymentStatus.PENDING;
        return {
          transactionId,
          status,
          amount: data.data.amount / 100, // PhonePe returns in paise
          providerResponse: data,
        };
      } else {
        return {
          transactionId,
          status: PaymentStatus.FAILED,
          amount: 0,
          failureReason: data.message,
        };
      }
    } catch (error) {
      this.logger.error(`PhonePe status check failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  async initiateRefund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(`Initiating PhonePe refund for transaction ${request.transactionId}`);

    const payload = {
      merchantId: this.merchantId,
      merchantUserId: this.merchantId, // Or specific user ID if available
      originalTransactionId: request.transactionId,
      merchantTransactionId: `REFUND_${request.transactionId}_${Date.now()}`,
      amount: request.amount * 100, // Amount in paise
      callbackUrl: `${this.configService.get('APP_URL')}/cart/webhook/refund`, // Optional
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const apiEndpoint = '/pg/v1/refund';
    const checksum = this.generateChecksum(base64Payload, apiEndpoint);

    try {
      const response = await axios.post(
        `${this.apiBaseUrl}${apiEndpoint}`,
        {
          request: base64Payload,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': checksum,
          },
        },
      );

      const data = response.data;
      if (data.success) {
        return {
          refundId: data.data.merchantTransactionId,
          status: 'INITIATED', // PhonePe usually processes instantly or queues it
          processedAt: new Date(),
        };
      } else {
        this.logger.error(`PhonePe refund failed: ${data.message}`);
        return {
          refundId: payload.merchantTransactionId,
          status: 'FAILED',
        };
      }
    } catch (error) {
      this.logger.error(`PhonePe refund error: ${error.message}`, error.response?.data);
      throw new InternalServerErrorException('Refund initiation failed');
    }
  }

  supportsFeature(feature: 'QR_CODE' | 'INTENT' | 'RECURRING' | 'INTERNATIONAL'): boolean {
    const supported = {
      QR_CODE: true,
      INTENT: true,
      RECURRING: false,
      INTERNATIONAL: false,
    };
    return supported[feature] || false;
  }

  private generateChecksum(payload: string, endpoint: string = ''): string {
    return crypto
      .createHash('sha256')
      .update(payload + endpoint + this.saltKey)
      .digest('hex') + '###' + this.saltIndex;
  }
}
