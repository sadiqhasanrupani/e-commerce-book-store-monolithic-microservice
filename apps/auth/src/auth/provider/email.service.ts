import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.example.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || 'user@example.com',
        pass: process.env.SMTP_PASS || 'password',
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
