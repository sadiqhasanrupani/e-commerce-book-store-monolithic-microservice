import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    
    /**
     * Configure the transporter with SMTP settings.
     * In a real application, use environment variables or a config service to manage sensitive information.
     * For demonstration, default values are provided.
     */
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.example.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendMail(to: string, subject: string, text: string) {
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@example.com',
      to,
      subject,
      text,
    });
  }

  async sendOtpEmail(to: string, otp: string) {
    const subject = 'Your OTP Code';
    const text = `Your OTP code is: ${otp}`;
    await this.sendMail(to, subject, text);
  }
}
