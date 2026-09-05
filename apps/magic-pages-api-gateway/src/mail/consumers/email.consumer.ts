import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { RmqService } from '@rmq/rmq';
import { MailService } from '../mail.service';

type EmailVerificationRequested = {
  userId?: number;
  email: string;
  name?: string;
  otp: string;
};

@Controller()
export class EmailConsumer {
  private readonly logger = new Logger(EmailConsumer.name);

  constructor(
    private readonly mailService: MailService,
    private readonly rmqService: RmqService,
  ) {}

  /**
   * Delivers the registration/login OTP email.
   *
   * Two things this handler must never do:
   *  - log the payload (it contains the OTP, which is a bearer secret);
   *  - let a send failure escape unlogged. Previously an SMTP error propagated out of the
   *    handler, the `ack` below never ran, and the failure was invisible: the API had
   *    already told the user "check your email".
   *
   * On failure we log the reason and still ack. `MailService.sendVerificationEmail` has
   * already retried three times with backoff, so the common remaining causes (bad
   * credentials, unroutable recipient) are permanent — redelivering forever would build a
   * poison-message backlog without ever succeeding. The user can re-trigger a fresh OTP.
   */
  @EventPattern('email_verification.requested')
  async handleEmailVerification(@Payload() data: EmailVerificationRequested, @Ctx() context: RmqContext) {
    const { email, name, otp } = data ?? ({} as EmailVerificationRequested);

    if (!email || !otp) {
      this.logger.error(`Discarding malformed email_verification.requested event (userId=${data?.userId ?? 'n/a'})`);
      this.rmqService.ack(context);
      return;
    }

    try {
      await this.mailService.sendVerificationEmail(email, name ?? '', otp);
      this.logger.log(`Verification email dispatched (userId=${data.userId ?? 'n/a'})`);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${email} (userId=${data.userId ?? 'n/a'}): ` +
          `${error instanceof Error ? error.message.split('\n')[0] : String(error)}. ` +
          'The user was told to check their inbox but will receive nothing — verify MAIL_* config.',
      );
    } finally {
      this.rmqService.ack(context);
    }
  }
}
