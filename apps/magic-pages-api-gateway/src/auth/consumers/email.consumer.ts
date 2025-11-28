import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { RmqService } from '@rmq/rmq';
import { MailService } from '../providers/mail.service';

@Controller()
export class EmailConsumer {
  private readonly logger = new Logger(EmailConsumer.name);
  constructor(
    private readonly mailService: MailService,
    private readonly rmqService: RmqService,
  ) { }

  @EventPattern('email_verification.requested')
  async handleEmailVerification(@Payload() data: any, @Ctx() context: RmqContext) {
    const { email, name, otp } = data;

    this.logger.log("data: ", data)
    console.log("[EmailConsumer]: data: ", data)

    await this.mailService.sendVerificationEmail(email, name, otp);
    this.rmqService.ack(context);
  }
}
