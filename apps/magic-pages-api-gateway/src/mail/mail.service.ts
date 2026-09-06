import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Retry, Timeout, CircuitBreaker } from 'libs/common/src';

import { EMAIL_PROVIDER_TOKEN } from '@app/contract/mail/tokens/email-provider.token';
import { EmailSendError, IEmailProvider } from '@app/contract/mail/interfaces/email-provider.interface';
import { InvoiceEmailData } from '@app/contract/mail/interfaces/invoice-email.interface';

/**
 * Application-facing mail API.
 *
 * This class owns everything that is true of *every* transport — the message
 * templates, HTML escaping, retry-with-backoff, the per-call timeout, and the
 * circuit breaker — and delegates only the final "put this on the wire" step to
 * the provider injected under {@link EMAIL_PROVIDER_TOKEN}.
 *
 * That split is the point of the refactor. The reliability machinery below took
 * real incidents to get right (OTP emails silently not sending; a delivery
 * marked SENT that never left the building). Duplicating it per provider would
 * mean re-earning those lessons in every new adapter, so a provider is
 * deliberately reduced to one `send()` method that either returns or throws
 * `EmailSendError`.
 *
 * Which provider is active is decided once, in `MailModule`, from
 * `MAIL_PROVIDER`. Nothing in this file knows or cares.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly emailCircuitBreaker: CircuitBreaker;

  constructor(
    @Inject(EMAIL_PROVIDER_TOKEN)
    private readonly provider: IEmailProvider,
  ) {
    // Initialize circuit breaker for email service
    this.emailCircuitBreaker = new CircuitBreaker('email-service', {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 10000, // 10 seconds
      resetTimeout: 60000, // 1 minute
    });
  }

  /**
   * Validate the transport's credentials at boot instead of discovering they are wrong
   * only when a user registers and silently never receives their code.
   *
   * Deliberately non-fatal: a mail outage should not stop the storefront from serving
   * traffic. It logs loudly and the provider's message names the env keys to fix.
   *
   * Providers without a meaningful pre-flight check (Resend — a stateless HTTPS
   * API with no connection to verify) simply omit `verifyConnection`, and this
   * skips it rather than faking one by sending a real message on every boot.
   */
  async onModuleInit(): Promise<void> {
    const providerName = this.provider.getProviderName();

    if (typeof this.provider.verifyConnection !== 'function') {
      this.logger.log(`Mail provider "${providerName}" has no boot-time connection check — skipping.`);
      return;
    }

    try {
      await this.provider.verifyConnection();
    } catch (error) {
      const detail = error instanceof EmailSendError ? ` (${error.describe()})` : '';
      this.logger.error(
        `Mail transport "${providerName}" failed its boot-time check${detail}: ` +
          `${error instanceof Error ? error.message : String(error)} ` +
          'Registration OTP emails and digital-delivery emails WILL NOT be delivered until this is fixed.',
      );
    }
  }

  /**
   * Send verification email with OTP
   * - Implements retry logic with exponential backoff (3 attempts)
   * - Implements timeout (10 seconds)
   * - Uses circuit breaker to prevent cascading failures
   *
   * Throws on definitive failure so the caller can log/alert. Never logs the OTP.
   */
  @Retry({
    maxAttempts: 3,
    delayMs: 1000,
    exponentialBackoff: true,
    maxDelayMs: 10000,
  })
  @Timeout(10000) // 10 second timeout
  async sendVerificationEmail(email: string, name: string, otp: string): Promise<void> {
    return await this.emailCircuitBreaker.execute(async () => {
      this.logger.log(`Sending verification email to ${email}`);

      const subject = 'Verify your email address - Magic Pages';
      const greeting = name ? `, ${name}` : '';
      const html = `
        <h1>Welcome to Magic Pages${greeting}!</h1>
        <p>Your verification code is: <strong>${otp}</strong></p>
        <p>This code will expire in 15 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `;

      await this.dispatch(email, subject, html);

      this.logger.log(`Verification email sent successfully to ${email}`);
    });
  }

  /**
   * Send the "your download is ready" e-mail for the digital lines of a paid
   * order.
   *
   * One e-mail per order, not per line: an order with three ebooks produces a
   * single message listing all three. `PaymentSettlementService` claims all the
   * eligible lines together and calls this once, which keeps the buyer out of a
   * three-message burst and keeps us out of spam filters.
   *
   * WHAT IS DELIBERATELY NOT IN HERE:
   *  - No file attachment. The material can be tens of megabytes; attaching it
   *    would blow past SMTP size limits and score badly with spam filters.
   *  - No object-storage URL. Book files are uploaded `public-read`, so a raw
   *    MinIO/S3 link would be a permanent, unauthenticated, forwardable copy of
   *    a paid product. The link below points at the storefront order page, from
   *    where the buyer's session calls the bearer-authed, ownership-checked
   *    download endpoint.
   *
   * Throws on definitive failure (after @Retry and the circuit breaker) so the
   * caller can record the line as FAILED rather than silently claiming success.
   *
   * @param email    buyer's address, read from `order.user.email` — never from
   *                 anything client-supplied
   * @param name     buyer's first name, optional
   * @param orderNumber display order reference, e.g. `MP-000123`
   * @param titles   book titles on the digital lines being delivered
   * @param orderUrl storefront deep link to the order page
   */
  @Retry({
    maxAttempts: 3,
    delayMs: 1000,
    exponentialBackoff: true,
    maxDelayMs: 10000,
  })
  @Timeout(10000) // 10 second timeout
  async sendDigitalDeliveryEmail(
    email: string,
    name: string | undefined,
    orderNumber: string,
    titles: string[],
    orderUrl: string,
  ): Promise<void> {
    return await this.emailCircuitBreaker.execute(async () => {
      this.logger.log(`Sending digital delivery email for ${orderNumber} to ${email}`);

      const subject = `Your download is ready — order ${orderNumber}`;
      const greeting = name ? `, ${name}` : '';
      const items = titles.map((title) => `<li>${escapeHtml(title)}</li>`).join('');

      const html = `
        <h1>Thanks for your purchase${escapeHtml(greeting)}!</h1>
        <p>Your payment for order <strong>${escapeHtml(orderNumber)}</strong> has gone through, and
           your digital material is ready to download:</p>
        <ul>${items}</ul>
        <p><a href="${escapeHtml(orderUrl)}">Open your order to download</a></p>
        <p>You will be asked to sign in to the account that placed the order. Your downloads stay
           available on that page — there is no need to keep this email.</p>
      `;

      await this.dispatch(email, subject, html);

      this.logger.log(`Digital delivery email sent successfully for ${orderNumber} to ${email}`);
    });
  }

  /**
   * Send the "we've got your order" e-mail for a paid order containing physical
   * (shippable) lines.
   *
   * The physical mirror of `sendDigitalDeliveryEmail`: a digital line's
   * confirmation IS its download e-mail, but a printed book previously produced
   * no message at all between paying and (nothing) — the buyer's only evidence
   * of the purchase was the storefront's success page.
   *
   * Dispatched by `PhysicalFulfillmentService` AFTER the settlement transaction
   * commits, for the same reason the digital one is: an e-mail cannot be rolled
   * back, so it must never precede a durable payment record.
   *
   * Throws on definitive failure (after @Retry and the circuit breaker). The
   * caller swallows that — a mail outage must not fail a settled payment.
   *
   * @param email       buyer's address, read from `order.user.email`
   * @param name        buyer's first name, optional
   * @param orderNumber display order reference, e.g. `MP-000123`
   * @param orderUrl    storefront deep link to the order page
   */
  @Retry({
    maxAttempts: 3,
    delayMs: 1000,
    exponentialBackoff: true,
    maxDelayMs: 10000,
  })
  @Timeout(10000)
  async sendOrderConfirmationEmail(
    email: string,
    name: string | undefined,
    orderNumber: string,
    orderUrl: string,
  ): Promise<void> {
    return await this.emailCircuitBreaker.execute(async () => {
      this.logger.log(`Sending order confirmation email for ${orderNumber} to ${email}`);

      const subject = `Order confirmed — ${orderNumber}`;
      const greeting = name ? `, ${name}` : '';

      const html = `
        <h1>Thanks for your order${escapeHtml(greeting)}!</h1>
        <p>We have received your payment for order <strong>${escapeHtml(orderNumber)}</strong> and
           we are getting it ready to ship.</p>
        <p>We will e-mail you again with tracking details as soon as it leaves us.</p>
        <p><a href="${escapeHtml(orderUrl)}">View your order</a></p>
      `;

      await this.dispatch(email, subject, html);

      this.logger.log(`Order confirmation email sent successfully for ${orderNumber} to ${email}`);
    });
  }

  /**
   * Send the "your order is on its way" e-mail, with the carrier and tracking
   * number an admin entered on `PATCH /admin/orders/:id/fulfillment`.
   *
   * `trackingUrl` is optional — when it is absent the message still names the
   * carrier and the AWB, which is enough for the buyer to track manually. The
   * link is rendered only when present, so we never emit an empty `href`.
   *
   * Throws on definitive failure; `PhysicalFulfillmentService` swallows it so a
   * mail outage cannot roll back a shipment that has physically happened.
   */
  @Retry({
    maxAttempts: 3,
    delayMs: 1000,
    exponentialBackoff: true,
    maxDelayMs: 10000,
  })
  @Timeout(10000)
  async sendOrderShippedEmail(
    email: string,
    name: string | undefined,
    orderNumber: string,
    carrier: string | null | undefined,
    trackingNumber: string | null | undefined,
    trackingUrl: string | null | undefined,
    orderUrl: string,
  ): Promise<void> {
    return await this.emailCircuitBreaker.execute(async () => {
      this.logger.log(`Sending order shipped email for ${orderNumber} to ${email}`);

      const subject = `Your order has shipped — ${orderNumber}`;
      const greeting = name ? `, ${name}` : '';

      const carrierLine = carrier ? `<p>Carrier: <strong>${escapeHtml(carrier)}</strong></p>` : '';
      const trackingLine = trackingNumber
        ? `<p>Tracking number: <strong>${escapeHtml(trackingNumber)}</strong></p>`
        : '';
      const trackingLink = trackingUrl
        ? `<p><a href="${escapeHtml(trackingUrl)}">Track your parcel</a></p>`
        : '';

      const html = `
        <h1>Your order is on its way${escapeHtml(greeting)}!</h1>
        <p>Order <strong>${escapeHtml(orderNumber)}</strong> has left us and is with the courier.</p>
        ${carrierLine}
        ${trackingLine}
        ${trackingLink}
        <p><a href="${escapeHtml(orderUrl)}">View your order</a></p>
      `;

      await this.dispatch(email, subject, html);

      this.logger.log(`Order shipped email sent successfully for ${orderNumber} to ${email}`);
    });
  }

  /**
   * Send the "your order was delivered" e-mail, the closing message of the
   * physical fulfilment lifecycle.
   *
   * Throws on definitive failure; the caller swallows it.
   */
  @Retry({
    maxAttempts: 3,
    delayMs: 1000,
    exponentialBackoff: true,
    maxDelayMs: 10000,
  })
  @Timeout(10000)
  async sendOrderDeliveredEmail(
    email: string,
    name: string | undefined,
    orderNumber: string,
    orderUrl: string,
  ): Promise<void> {
    return await this.emailCircuitBreaker.execute(async () => {
      this.logger.log(`Sending order delivered email for ${orderNumber} to ${email}`);

      const subject = `Delivered — ${orderNumber}`;
      const greeting = name ? `, ${name}` : '';

      const html = `
        <h1>Your order has arrived${escapeHtml(greeting)}!</h1>
        <p>Order <strong>${escapeHtml(orderNumber)}</strong> has been marked as delivered.</p>
        <p>If anything is missing or damaged, reply to this e-mail and we will sort it out.</p>
        <p><a href="${escapeHtml(orderUrl)}">View your order</a></p>
      `;

      await this.dispatch(email, subject, html);

      this.logger.log(`Order delivered email sent successfully for ${orderNumber} to ${email}`);
    });
  }

  /**
   * Send the tax invoice for a paid order.
   *
   * Rendered as HTML in the message body rather than attached as a PDF, and
   * that is a decision rather than an omission: `EmailSendParams` — the seam
   * every transport goes through — carries only `to`/`subject`/`html`/`text`,
   * and NEITHER provider implements attachments (`SmtpProvider` forwards those
   * four fields to nodemailer, `ResendProvider` forwards the same four to the
   * Resend API). Attaching a PDF would therefore mean widening the provider
   * contract, implementing it twice, and adding a PDF renderer to a dependency
   * list that has none. An HTML invoice needs none of that, renders in every
   * client, stays searchable in the buyer's mailbox, and can be printed to PDF
   * by the reader if they want one.
   *
   * This method does no arithmetic. Every figure in `data` was read off the
   * recorded order and formatted by `InvoiceIssuanceService`, so the invoice
   * cannot disagree with what the customer was charged — see
   * {@link InvoiceEmailData}.
   *
   * Throws on definitive failure (after `@Retry` and the circuit breaker).
   * `InvoiceIssuanceService` swallows that: the invoice row is already durable,
   * and a mail outage must not turn a settled payment into a 500.
   *
   * @param email buyer's address, read from `order.user.email` — never from
   *        anything client-supplied
   * @param name  buyer's first name, optional
   */
  @Retry({
    maxAttempts: 3,
    delayMs: 1000,
    exponentialBackoff: true,
    maxDelayMs: 10000,
  })
  @Timeout(10000)
  async sendInvoiceEmail(email: string, name: string | undefined, data: InvoiceEmailData): Promise<void> {
    return await this.emailCircuitBreaker.execute(async () => {
      this.logger.log(`Sending invoice ${data.invoiceNumber} for ${data.orderNumber} to ${email}`);

      const subject = `Invoice ${data.invoiceNumber} — order ${data.orderNumber}`;
      const greeting = name ? `, ${name}` : '';
      const currency = escapeHtml(data.currency);

      const rows = data.lines
        .map((line) => {
          // An untaxed line prints an em dash rather than "0.00%", so "this line
          // carried no tax" stays distinguishable from "this line was taxed at
          // zero" — the same distinction `order_items.tax_percentage` stores as
          // NULL versus 0.
          const rate = line.taxRate === null ? '&mdash;' : `${escapeHtml(line.taxRate)}%`;

          return `
            <tr>
              <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(line.title)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${line.quantity}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${escapeHtml(line.unitPrice)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${rate}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${escapeHtml(line.lineTotal)}</td>
            </tr>`;
        })
        .join('');

      // Shipping is shown only when something was actually charged for it, so a
      // digital-only invoice does not carry a meaningless "Shipping 0.00" line.
      const shippingRow =
        Number(data.shippingTotal) > 0
          ? `<tr>
               <td style="padding:4px 10px;text-align:right;" colspan="4">Shipping</td>
               <td style="padding:4px 10px;text-align:right;">${currency} ${escapeHtml(data.shippingTotal)}</td>
             </tr>`
          : '';

      const billToBlock = data.billTo
        ? `<p style="margin:0 0 16px;"><strong>Billed to</strong><br/>${escapeHtml(data.billTo).replace(/\n/g, '<br/>')}</p>`
        : '';

      const html = `
        <h1>Your invoice${escapeHtml(greeting)}</h1>
        <p>Here is the tax invoice for order <strong>${escapeHtml(data.orderNumber)}</strong>.</p>
        <p style="margin:0 0 4px;"><strong>Invoice number:</strong> ${escapeHtml(data.invoiceNumber)}</p>
        <p style="margin:0 0 16px;"><strong>Invoice date:</strong> ${escapeHtml(data.invoiceDate)}</p>
        ${billToBlock}
        <table style="border-collapse:collapse;width:100%;max-width:640px;">
          <thead>
            <tr>
              <th style="padding:6px 10px;border-bottom:2px solid #333;text-align:left;">Item</th>
              <th style="padding:6px 10px;border-bottom:2px solid #333;text-align:right;">Qty</th>
              <th style="padding:6px 10px;border-bottom:2px solid #333;text-align:right;">Unit price</th>
              <th style="padding:6px 10px;border-bottom:2px solid #333;text-align:right;">Tax rate</th>
              <th style="padding:6px 10px;border-bottom:2px solid #333;text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr>
              <td style="padding:4px 10px;text-align:right;" colspan="4">Items</td>
              <td style="padding:4px 10px;text-align:right;">${currency} ${escapeHtml(data.itemsTotal)}</td>
            </tr>
            ${shippingRow}
            <tr>
              <td style="padding:8px 10px;text-align:right;border-top:2px solid #333;" colspan="4">
                <strong>Total paid</strong>
              </td>
              <td style="padding:8px 10px;text-align:right;border-top:2px solid #333;">
                <strong>${currency} ${escapeHtml(data.grandTotal)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
        <p style="margin:12px 0;">All prices are tax inclusive. This total includes tax of
           <strong>${currency} ${escapeHtml(data.taxTotal)}</strong>.</p>
        <p><a href="${escapeHtml(data.orderUrl)}">View your order</a></p>
      `;

      await this.dispatch(email, subject, html);

      this.logger.log(`Invoice ${data.invoiceNumber} sent successfully to ${email}`);
    });
  }

  /**
   * The one place this service touches a transport.
   *
   * Logs why a send was refused (never the body, the OTP, or the credentials)
   * and rethrows, so `@Retry` can take another run at it and the caller can
   * record the final failure. Every public method funnels through here so the
   * paths cannot drift in how they handle or log failure.
   */
  private async dispatch(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.provider.send({ to, subject, html });
    } catch (error) {
      const detail = error instanceof EmailSendError ? error.describe() : `provider=${this.provider.getProviderName()}`;

      this.logger.error(
        `Email send failed for ${to} (${detail}): ` +
          `${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      );

      throw error;
    }
  }
}

/**
 * Minimal HTML escaping for values interpolated into the mail body.
 *
 * Book titles are admin-supplied and the order number is generated, so this is
 * defence in depth rather than a known hole — but an apostrophe or an ampersand
 * in a title should not be able to break the markup of a transactional e-mail.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
