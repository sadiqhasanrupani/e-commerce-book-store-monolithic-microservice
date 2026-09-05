import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Resend } from 'resend';

import mailConfig from '@app/contract/mail/configs/mail.config';
import {
  EmailSendError,
  EmailSendParams,
  EmailSendResult,
  IEmailProvider,
  MailProvider,
} from '@app/contract/mail/interfaces/email-provider.interface';

/**
 * Resend HTTP API transport, selected with `MAIL_PROVIDER=resend`.
 *
 * Not active in any deployment yet — it exists so switching off SMTP is a
 * config change rather than a code change.
 *
 * ## The one thing to know about the Resend SDK
 *
 * `resend.emails.send()` **does not throw on API failure.** It resolves to
 * `{ data, error }`, where a rejected send comes back as
 * `{ data: null, error: { message, name, statusCode } }` and the promise is
 * fulfilled either way. That is a genuine hazard here: `MailService` wraps
 * every send in `@Retry` and a circuit breaker, and both of those only react to
 * exceptions. Returning normally on `error` would make a hard failure — an
 * invalid API key, an unverified sending domain, a rate limit — look like a
 * successful delivery, so digital-delivery lines would be marked SENT and
 * buyers would never receive their download email.
 *
 * So this adapter checks `error` explicitly and converts it into a throw. Only
 * transport-level problems (DNS, TLS, socket) actually reject, and those are
 * caught and normalised too, so exactly one error type leaves this class.
 *
 * Env keys: RESEND_API_KEY, MAIL_FROM.
 */
@Injectable()
export class ResendProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendProvider.name);
  private readonly resend: Resend;

  constructor(
    @Inject(mailConfig.KEY)
    private readonly mailConfiguration: ConfigType<typeof mailConfig>,
  ) {
    const apiKey = this.mailConfiguration.resendApiKey;

    if (!apiKey) {
      // Joi requires RESEND_API_KEY when MAIL_PROVIDER=resend, so reaching here
      // means someone constructed this provider outside the normal boot path.
      // Warn rather than throw, matching how RazorpayProvider handles missing
      // keys — the app still boots, and the first send fails loudly.
      this.logger.warn('Resend configuration missing (RESEND_API_KEY) — sends will fail.');
    }

    this.resend = new Resend(apiKey);
  }

  getProviderName(): MailProvider {
    return MailProvider.RESEND;
  }

  /**
   * Deliberately no `verifyConnection()`.
   *
   * Resend is a stateless HTTPS API — there is no connection to open and
   * authenticate ahead of time, so there is no equivalent of nodemailer's
   * `.verify()`. The only way to prove the key works would be to send a real
   * message on every boot, which is worse than not checking. `MailService` sees
   * the method is absent and skips the boot check; a bad key surfaces on the
   * first real send, with the API's own error message.
   */

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    const from = this.mailConfiguration.from;

    if (!from) {
      throw new EmailSendError('Mailer is not configured — MAIL_FROM is missing.', MailProvider.RESEND, {
        code: 'ECONFIG',
      });
    }

    let response: Awaited<ReturnType<Resend['emails']['send']>>;

    try {
      response = await this.resend.emails.send({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
      });
    } catch (error) {
      // Transport-level failure (DNS, TLS, socket, abort) — the SDK rejects for
      // these rather than returning an `error` field.
      throw new EmailSendError(
        `Resend request failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        MailProvider.RESEND,
        { code: 'ETRANSPORT', cause: error },
      );
    }

    // The important branch: an API-level rejection arrives here as a *value*.
    if (response?.error) {
      const { message, name, statusCode } = response.error;

      throw new EmailSendError(`Resend send rejected: ${message}`, MailProvider.RESEND, {
        code: name,
        statusCode: statusCode ?? undefined,
        cause: response.error,
      });
    }

    if (!response?.data?.id) {
      // Neither an error nor an id. Treat as a failure rather than reporting a
      // delivery we cannot evidence.
      throw new EmailSendError('Resend returned neither an email id nor an error.', MailProvider.RESEND, {
        code: 'EMALFORMED',
      });
    }

    return { providerId: response.data.id };
  }
}
