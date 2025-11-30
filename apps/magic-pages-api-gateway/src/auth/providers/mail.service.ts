import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Retry, Timeout, CircuitBreaker } from 'libs/common/src';
import mailConfig from '@app/global-config/configs/mail.config';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);
  private readonly emailCircuitBreaker: CircuitBreaker;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('mail.host'),
      port: this.configService.get<number>('mail.port'),
      auth: {
        user: this.configService.get<string>('mail.user'),
        pass: this.configService.get<string>('mail.pass'),
      },
    });

    // Initialize circuit breaker for email service
    this.emailCircuitBreaker = new CircuitBreaker('email-service', {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 10000, // 10 seconds
      resetTimeout: 60000, // 1 minute
    });
  }

  /**
   * Send verification email with OTP
   * - Implements retry logic with exponential backoff (3 attempts)
   * - Implements timeout (10 seconds)
   * - Uses circuit breaker to prevent cascading failures
   */
  @Retry({
    maxAttempts: 3,
    delayMs: 1000,
    exponentialBackoff: true,
    maxDelayMs: 10000
  })
  @Timeout(10000) // 10 second timeout
  async sendVerificationEmail(
    email: string,
    name: string,
    otp: string,
  ): Promise<void> {
    return await this.emailCircuitBreaker.execute(async () => {
      this.logger.log(`Sending verification email to ${email}`);

      const from = this.configService.get<string>('mail.from');
      const subject = 'Verify your email address - Magic Pages';
      const html = `
        <h1>Welcome to Magic Pages, ${name}!</h1>
        <p>Your verification code is: <strong>${otp}</strong></p>
        <p>This code will expire in 15 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `;

      await this.transporter.sendMail({
        from,
        to: email,
        subject,
        html,
      });

      this.logger.log(`Verification email sent successfully to ${email}`);
    });
  }
}
