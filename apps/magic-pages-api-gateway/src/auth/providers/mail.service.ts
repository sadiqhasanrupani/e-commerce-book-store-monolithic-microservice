import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import mailConfig from '@app/global-config/configs/mail.config';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('mail.host'),
      port: this.configService.get<number>('mail.port'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: this.configService.get<string>('mail.user'),
        pass: this.configService.get<string>('mail.pass'),
      },
    });
  }

  async sendVerificationEmail(to: string, name: string, otp: string) {
    const from = this.configService.get<string>('mail.from');
    const subject = 'Verify your email address';
    const html = `
      <h1>Welcome, ${name}!</h1>
      <p>Please use the following OTP to verify your email address:</p>
      <h2>${otp}</h2>
      <p>This code will expire in 15 minutes.</p>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject,
        html,
      });
      this.logger.log(`Verification email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${to}`, error);
      throw error;
    }
  }
}
