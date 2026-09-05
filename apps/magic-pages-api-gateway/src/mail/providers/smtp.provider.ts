import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import mailConfig from '@app/contract/mail/configs/mail.config';
import {
  EmailSendError,
  EmailSendParams,
  EmailSendResult,
  IEmailProvider,
  MailProvider,
} from '@app/contract/mail/interfaces/email-provider.interface';

/**
 * Nodemailer/SMTP transport — the default, and the only one that has ever run
 * in production.
 *
 * This class is a straight extraction of what used to sit inline in
 * `MailService`: the same transporter options, the same `MAIL_SECURE` string
 * handling, the same boot-time `.verify()`, the same timeouts. Nothing about
 * how mail is sent changed in the provider refactor — only where the code
 * lives. Treat any behavioural difference from the pre-refactor service as a
 * bug in this file.
 *
 * Env keys: MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM, MAIL_SECURE.
 */
@Injectable()
export class SmtpProvider implements IEmailProvider {
  private readonly logger = new Logger(SmtpProvider.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    @Inject(mailConfig.KEY)
    private readonly mailConfiguration: ConfigType<typeof mailConfig>,
  ) {
    const port = this.mailConfiguration.port ?? 587;

    // `mail.config.ts` reads MAIL_SECURE straight out of `process.env`, so this
    // arrives as a STRING, not a boolean — and the string "false" is truthy.
    // Passing it through unconverted both failed to type-check (nodemailer wants
    // a boolean) and, worse, would have switched on implicit TLS for anyone who
    // set `MAIL_SECURE=false`, which breaks submission on the usual port 587.
    // Only the literal "true" (or a real boolean true) enables it.
    const secure = String(this.mailConfiguration.secure).toLowerCase() === 'true';

    this.transporter = nodemailer.createTransport({
      host: this.mailConfiguration.host,
      // Use the defaulted `port` rather than the raw config value, so a missing
      // MAIL_PORT falls back to 587 instead of reaching nodemailer as undefined.
      port,
      secure,

      auth: {
        user: this.mailConfiguration.user,
        pass: this.mailConfiguration.pass?.replace(/\s+/g, ''),
      },

      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  getProviderName(): MailProvider {
    return MailProvider.SMTP;
  }

  /**
   * Validate SMTP credentials at boot instead of discovering they are wrong only when a
   * user registers and silently never receives their code.
   *
   * Throws rather than logging-and-returning so `MailService` decides how loud
   * to be; `MailService` treats it as non-fatal, because a mail outage should
   * not stop the storefront from serving traffic. The remediation guidance is
   * baked into the message here because it is SMTP-specific and `MailService`
   * is deliberately provider-agnostic.
   */
  async verifyConnection(): Promise<void> {
    if (!this.mailConfiguration.host || !this.mailConfiguration.user || !this.mailConfiguration.pass) {
      throw new EmailSendError(
        'Mailer is not configured — MAIL_HOST / MAIL_USER / MAIL_PASS are missing.',
        MailProvider.SMTP,
        { code: 'ECONFIG' },
      );
    }

    try {
      await this.transporter.verify();
      this.logger.log(
        `SMTP transport verified (host=${this.mailConfiguration.host}, user=${this.mailConfiguration.user})`,
      );
    } catch (error) {
      const { code, responseCode } = (error ?? {}) as { code?: string; responseCode?: number };
      throw new EmailSendError(
        `SMTP transport FAILED to authenticate (host=${this.mailConfiguration.host}, ` +
          `user=${this.mailConfiguration.user}): ` +
          `${error instanceof Error ? error.message.split('\n')[0] : String(error)}. ` +
          'Replace MAIL_USER / MAIL_PASS in .env.<NODE_ENV> with valid credentials (for Gmail: a ' +
          '16-character App Password from an account with 2-Step Verification enabled).',
        MailProvider.SMTP,
        { code, statusCode: responseCode, cause: error },
      );
    }
  }

  /**
   * Hand one message to the SMTP server.
   *
   * The `from` address comes from `MAIL_FROM`, not from the caller — see the
   * note on `EmailSendParams`.
   *
   * Nodemailer decorates its errors with `code` (`EAUTH`, `ECONNECTION`, …) and
   * `responseCode` (the numeric SMTP reply). Both are lifted onto
   * `EmailSendError` so `MailService` can log them without importing anything
   * nodemailer-shaped, and so a Resend failure logs through the same fields.
   */
  async send(params: EmailSendParams): Promise<EmailSendResult> {
    try {
      // `sendMail` is typed as returning `any`, so narrow it explicitly rather
      // than letting an untyped value flow into the result.
      const info = (await this.transporter.sendMail({
        from: this.mailConfiguration.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      })) as { messageId?: string } | undefined;

      return { providerId: info?.messageId };
    } catch (error) {
      const { code, responseCode } = (error ?? {}) as { code?: string; responseCode?: number };

      // Never include the body, the OTP, or the credentials — this message is logged.
      throw new EmailSendError(
        `SMTP send failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        MailProvider.SMTP,
        { code, statusCode: responseCode, cause: error },
      );
    }
  }
}
