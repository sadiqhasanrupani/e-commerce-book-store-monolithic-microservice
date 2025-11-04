import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { EmailService } from './email.service';

@Controller()
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @MessagePattern('email.sendOtp')
  async sendOtp(@Payload() payload: { email: string; otp: string }) {
    await this.emailService.sendOtpEmail(payload.email, payload.otp);
    return { message: 'OTP sent successfully' };
  }
}
