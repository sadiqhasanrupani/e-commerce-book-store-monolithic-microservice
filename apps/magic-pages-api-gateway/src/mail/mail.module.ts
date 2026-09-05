import { Logger, Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { GlobalConfigModule } from '@app/global-config';
import mailConfig from '@app/contract/mail/configs/mail.config';
import { EMAIL_PROVIDER_TOKEN } from '@app/contract/mail/tokens/email-provider.token';
import { IEmailProvider, MailProvider } from '@app/contract/mail/interfaces/email-provider.interface';

import { MailService } from './mail.service';
import { SmtpProvider } from './providers/smtp.provider';
import { ResendProvider } from './providers/resend.provider';

/**
 * Owns the single `MailService` instance for the whole application, and decides
 * once — here — which transport backs it.
 *
 * `MailService` used to be declared directly in `AuthModule` and was reachable
 * only from there, because OTP was the only thing we mailed. Digital delivery
 * added a second sender (`PaymentSettlementService`, via
 * `DigitalDeliveryService`) that lives on the other side of the app, so the
 * provider needed a home both sides can import.
 *
 * It is a module rather than a re-export from `AuthModule` on purpose:
 * `AuthModule` drags in `UsersModule` (via `forwardRef`) and `RmqModule`, and
 * making the cart/orders graph depend on all of that just to send an e-mail
 * would be a real coupling problem, plus a `forwardRef` cycle waiting to
 * happen. This module's only dependency is the config that holds the mail
 * credentials.
 *
 * Keeping it to ONE instance matters: an SMTP provider opens a transporter and
 * verifies it at boot, and `MailService` holds a circuit breaker. A second copy
 * would mean a second connection, a duplicate boot-time verify log, and two
 * circuit breakers each with their own half-open view of the same server.
 *
 * ## Why a factory rather than listing both providers
 *
 * `SmtpProvider` and `ResendProvider` both build a client in their constructor
 * — a nodemailer transporter, a Resend HTTP client. Declaring both as ordinary
 * providers would instantiate both on every boot, so an SMTP-only deployment
 * would still construct a Resend client with an undefined API key (and log the
 * warning about it), and vice versa. The factory constructs exactly the one
 * that `MAIL_PROVIDER` names and never touches the other.
 */
/**
 * Builds the one transport named by `MAIL_PROVIDER`.
 *
 * Exported (rather than inlined into `useFactory`) so the selection rule —
 * especially "unset means SMTP" — is directly testable without booting Nest.
 * That default is load-bearing: it is what makes this refactor a no-op for
 * every existing deployment.
 */
export function createEmailProvider(configuration: ConfigType<typeof mailConfig>): IEmailProvider {
  const logger = new Logger(MailModule.name);

  // Joi validates the value, so this normally only ever sees a known member.
  // The `??` and the default arm cover config built without Joi (unit tests,
  // scripts) and a value that somehow bypassed validation — in both cases the
  // safe answer is the transport production already runs.
  const selected = configuration.provider ?? MailProvider.SMTP;

  switch (selected) {
    case MailProvider.RESEND:
      logger.log('Mail provider: resend (MAIL_PROVIDER=resend)');
      return new ResendProvider(configuration);

    case MailProvider.SMTP:
      logger.log('Mail provider: smtp');
      return new SmtpProvider(configuration);

    default:
      logger.warn(`Unknown MAIL_PROVIDER "${String(selected)}" — falling back to smtp.`);
      return new SmtpProvider(configuration);
  }
}

@Module({
  imports: [GlobalConfigModule],
  providers: [
    {
      provide: EMAIL_PROVIDER_TOKEN,
      inject: [mailConfig.KEY],
      useFactory: createEmailProvider,
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
