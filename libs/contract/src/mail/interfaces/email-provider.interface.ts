/**
 * Mail provider abstraction.
 *
 * This is the seam that lets the application swap the thing that actually puts
 * a message on the wire (SMTP today, Resend when `MAIL_PROVIDER=resend`)
 * without any caller knowing which one is in play. It mirrors
 * `apps/magic-pages-api-gateway/src/cart/interfaces/payment-provider.interface.ts`
 * on purpose: one narrow interface, one DI token, one config-driven factory.
 *
 * The interface is deliberately tiny. Everything that is NOT "hand these bytes
 * to a mail transport" — templating, retries, timeouts, the circuit breaker,
 * HTML escaping, the from-address policy — stays in `MailService`, so a second
 * provider is one class rather than a second copy of all that logic.
 *
 * Two rules keep the seam honest:
 *
 *  1. **No provider-specific fields leak through.** `EmailSendParams` carries
 *     only what any transport can accept. Nodemailer's `envelope`, Resend's
 *     `tags`/`react`/`scheduledAt` and friends stay behind their adapters. If a
 *     field cannot be honoured by both providers, it does not belong here.
 *  2. **No raw SDK exception escapes an adapter.** Nodemailer throws Error
 *     objects decorated with `code`/`responseCode`; Resend does not throw at
 *     all for API-level failures, it returns `{ error }`. Callers must not have
 *     to know that. Every adapter normalises both shapes into `EmailSendError`.
 */

/** Transports the application knows how to construct. Selected by `MAIL_PROVIDER`. */
export enum MailProvider {
  SMTP = 'smtp',
  RESEND = 'resend',
}

/**
 * One outbound message.
 *
 * Note what is absent: `from`. The sender identity is deployment configuration
 * (`MAIL_FROM`), not a per-message decision, so each adapter reads it from
 * `mailConfig` itself. Keeping it out of the params means no caller can
 * accidentally send as someone else, and `MailService` never has to care which
 * address a given provider is allowed to send from.
 */
export interface EmailSendParams {
  /** Single recipient address. Always derived server-side, never from a request body. */
  to: string;
  subject: string;
  /** Rendered HTML body. Callers are responsible for escaping interpolated values. */
  html: string;
  /** Optional plain-text alternative. Providers that support multipart will attach it. */
  text?: string;
}

/** What the transport accepted. */
export interface EmailSendResult {
  /**
   * The transport's own identifier for the accepted message — nodemailer's
   * `messageId`, Resend's email `id`. Useful for correlating with a provider
   * dashboard when someone reports a missing email. Optional because not every
   * transport returns one.
   */
  providerId?: string;
}

/**
 * The single error type that crosses the provider seam.
 *
 * Normalising matters for more than tidiness: `MailService` logs the failure
 * reason and `@Retry` re-runs the call, and both of those behaved correctly
 * only because they were written against nodemailer's error shape. Resend's
 * failures arrive as a returned value rather than a thrown one, so without a
 * common type a Resend failure would have looked like a *success* to the retry
 * decorator and the circuit breaker.
 *
 * Never put a recipient's message body, an OTP, or an API key in here — this
 * gets logged.
 */
export class EmailSendError extends Error {
  /** Which transport produced the failure. */
  readonly provider: MailProvider;

  /**
   * Transport-level symbolic code where one exists: nodemailer's `code`
   * (`EAUTH`, `ECONNECTION`, `ETIMEDOUT`, …) or Resend's error `name`
   * (`validation_error`, `rate_limit_exceeded`, …).
   */
  readonly code?: string;

  /**
   * Numeric status: the SMTP response code (535, 550, …) or Resend's HTTP
   * status. Same field for both because "the server said no, with this number"
   * is the only thing callers do with it.
   */
  readonly statusCode?: number;

  constructor(
    message: string,
    provider: MailProvider,
    options: { code?: string; statusCode?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'EmailSendError';
    this.provider = provider;
    this.code = options.code;
    this.statusCode = options.statusCode;

    if (options.cause !== undefined) {
      // Keep the original for a stack trace in the logs without making callers
      // reach for provider-specific properties on it.
      (this as { cause?: unknown }).cause = options.cause;
    }

    Error.captureStackTrace?.(this, EmailSendError);
  }

  /** Compact, log-safe summary used by `MailService`. */
  describe(): string {
    return `provider=${this.provider}, code=${this.code ?? 'n/a'}, statusCode=${this.statusCode ?? 'n/a'}`;
  }
}

/**
 * Everything a mail transport must be able to do.
 *
 * Implementations live next to the app that constructs them
 * (`apps/magic-pages-api-gateway/src/mail/providers/`), not here — this library
 * holds the contract only, the same way `libs/contract` holds entities and DTOs
 * rather than services.
 */
export interface IEmailProvider {
  /** For logging and for asserting in tests which transport got wired up. */
  getProviderName(): MailProvider;

  /**
   * Hand one message to the transport.
   *
   * MUST throw {@link EmailSendError} — and nothing else — on failure. A
   * provider whose SDK signals failure by return value (Resend) is responsible
   * for converting that into a throw, because `MailService`'s retry decorator
   * and circuit breaker only react to exceptions.
   */
  send(params: EmailSendParams): Promise<EmailSendResult>;

  /**
   * Optional boot-time credential check.
   *
   * Optional because it is genuinely provider-specific: SMTP can open a socket
   * and authenticate before any user needs an email (nodemailer's `.verify()`),
   * which is how a wrong `MAIL_PASS` gets caught at deploy time instead of
   * being discovered by a user who never receives their OTP. Resend has no
   * equivalent — it is a stateless HTTPS API with no connection to pre-verify —
   * so `ResendProvider` simply does not implement this, and `MailService` skips
   * the check rather than inventing a fake one (a "verification" that sent a
   * real test email on every boot would be worse than none).
   *
   * MUST throw {@link EmailSendError} on failure. Callers treat it as
   * non-fatal: a mail outage should not stop the storefront from serving
   * traffic.
   */
  verifyConnection?(): Promise<void>;
}
