import { Test, TestingModule } from '@nestjs/testing';

import { EMAIL_PROVIDER_TOKEN } from '@app/contract/mail/tokens/email-provider.token';
import { EmailSendError, IEmailProvider, MailProvider } from '@app/contract/mail/interfaces/email-provider.interface';
import { InvoiceEmailData } from '@app/contract/mail/interfaces/invoice-email.interface';

import { captureEmailError } from './mail.test-utils';
import { MailService } from './mail.service';

/**
 * `MailService` after the provider refactor: it must own the templates and the
 * reliability behaviour, and must reach the transport ONLY through
 * `IEmailProvider.send()`.
 */
describe('MailService', () => {
  let service: MailService;
  let provider: jest.Mocked<IEmailProvider> & { verifyConnection?: jest.Mock };

  async function build(overrides: Partial<IEmailProvider> = {}): Promise<void> {
    provider = {
      getProviderName: jest.fn().mockReturnValue(MailProvider.SMTP),
      send: jest.fn().mockResolvedValue({ providerId: 'msg-1' }),
      verifyConnection: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as jest.Mocked<IEmailProvider> & { verifyConnection?: jest.Mock };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [MailService, { provide: EMAIL_PROVIDER_TOKEN, useValue: provider }],
    }).compile();

    service = moduleRef.get(MailService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    await build();
  });

  describe('sendVerificationEmail', () => {
    it('delegates to the injected provider with the OTP template', async () => {
      await service.sendVerificationEmail('user@example.test', 'Sadiq', '123456');

      expect(provider.send).toHaveBeenCalledTimes(1);
      const params = provider.send.mock.calls[0][0];

      expect(params.to).toBe('user@example.test');
      expect(params.subject).toBe('Verify your email address - Magic Pages');
      expect(params.html).toContain('123456');
      expect(params.html).toContain('Sadiq');
    });

    it('renders without a name when none is supplied', async () => {
      await service.sendVerificationEmail('user@example.test', '', '123456');

      expect(provider.send.mock.calls[0][0].html).toContain('Welcome to Magic Pages!');
    });

    /**
     * The OTP is a bearer secret. It belongs in the message body and nowhere
     * else — not in a log line, and not in an error that gets logged.
     */
    it('rethrows the provider error without leaking the OTP into it', async () => {
      provider.send.mockRejectedValue(new EmailSendError('SMTP send failed: refused', MailProvider.SMTP));

      const error = await captureEmailError(service.sendVerificationEmail('user@example.test', 'Sadiq', '654321'));

      expect(error).toBeInstanceOf(EmailSendError);
      expect(error.message).not.toContain('654321');
    }, 15000);
  });

  describe('sendDigitalDeliveryEmail', () => {
    it('sends ONE email listing every title on the order', async () => {
      await service.sendDigitalDeliveryEmail(
        'buyer@example.test',
        'Sadiq',
        'MP-000123',
        ['The Hobbit', 'Dune'],
        'https://storefront.test/orders/123',
      );

      expect(provider.send).toHaveBeenCalledTimes(1);
      const { subject, html } = provider.send.mock.calls[0][0];

      expect(subject).toBe('Your download is ready — order MP-000123');
      expect(html).toContain('<li>The Hobbit</li>');
      expect(html).toContain('<li>Dune</li>');
      expect(html).toContain('https://storefront.test/orders/123');
    });

    it('escapes HTML in admin-supplied book titles', async () => {
      await service.sendDigitalDeliveryEmail(
        'buyer@example.test',
        undefined,
        'MP-1',
        ['<script>alert(1)</script> & "quoted"'],
        'https://storefront.test/orders/1',
      );

      const { html } = provider.send.mock.calls[0][0];

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&amp;');
      expect(html).toContain('&quot;');
    });

    /**
     * Never sends the object-storage URL — book files are uploaded public-read,
     * so a raw link would be a permanent unauthenticated copy of a paid product.
     */
    it('links to the storefront order page, not to object storage', async () => {
      await service.sendDigitalDeliveryEmail(
        'buyer@example.test',
        'Sadiq',
        'MP-1',
        ['Dune'],
        'https://storefront.test/orders/1',
      );

      const { html } = provider.send.mock.calls[0][0];

      expect(html).not.toMatch(/minio|s3\.|amazonaws|digitaloceanspaces/i);
    });
  });

  describe('sendInvoiceEmail', () => {
    const invoiceData = (overrides: Partial<InvoiceEmailData> = {}): InvoiceEmailData => ({
      invoiceNumber: 'INV-20260906-0001',
      invoiceDate: '2026-09-06',
      orderNumber: 'MP-000042',
      currency: 'INR',
      lines: [
        {
          title: 'The Digital Book',
          quantity: 2,
          unitPrice: '250.00',
          lineTotal: '500.00',
          taxRate: '18.00',
          taxAmount: '76.27',
        },
        {
          title: 'A Paperback',
          quantity: 1,
          unitPrice: '300.00',
          lineTotal: '300.00',
          taxRate: null,
          taxAmount: '0.00',
        },
      ],
      itemsTotal: '800.00',
      shippingTotal: '50.00',
      taxTotal: '76.27',
      grandTotal: '850.00',
      billTo: 'Ada Lovelace\n12, MG Road\nMumbai',
      orderUrl: 'https://storefront.test/orders?order=42',
      ...overrides,
    });

    it('renders the invoice as HTML in the body, with no attachment', async () => {
      await service.sendInvoiceEmail('buyer@example.test', 'Ada', invoiceData());

      expect(provider.send).toHaveBeenCalledTimes(1);
      const params = provider.send.mock.calls[0][0];

      expect(params.to).toBe('buyer@example.test');
      expect(params.subject).toBe('Invoice INV-20260906-0001 — order MP-000042');
      expect(params.html).toContain('INV-20260906-0001');
      expect(params.html).toContain('The Digital Book');
      expect(params.html).toContain('A Paperback');
      // Neither provider supports attachments; `EmailSendParams` has no such
      // field, and this asserts the template did not try to invent one.
      expect(params).not.toHaveProperty('attachments');
    });

    /**
     * The figures are the whole point of the document. They are passed in
     * pre-formatted precisely so the template cannot re-derive them, and this
     * checks the total the customer actually paid reaches the page intact.
     */
    it('prints the charged total and states the tax as inclusive', async () => {
      const { html } = await service
        .sendInvoiceEmail('buyer@example.test', 'Ada', invoiceData())
        .then(() => provider.send.mock.calls[0][0]);

      expect(html).toContain('850.00');
      expect(html).toContain('50.00');
      expect(html).toMatch(/tax inclusive/i);
      expect(html).toContain('76.27');
    });

    /** A digital-only order pays no shipping, so it gets no shipping line. */
    it('omits the shipping row when nothing was charged for shipping', async () => {
      await service.sendInvoiceEmail('buyer@example.test', 'Ada', invoiceData({ shippingTotal: '0.00' }));

      expect(provider.send.mock.calls[0][0].html).not.toContain('>Shipping<');
    });

    /**
     * `order_items.tax_percentage` is nullable on purpose: NULL means the line
     * was never taxed, which is distinct from a stored 0.
     */
    it('prints a dash rather than 0% for an untaxed line', async () => {
      await service.sendInvoiceEmail('buyer@example.test', 'Ada', invoiceData());

      const { html } = provider.send.mock.calls[0][0];
      expect(html).toContain('18.00%');
      expect(html).toContain('&mdash;');
    });

    it('escapes interpolated values', async () => {
      await service.sendInvoiceEmail(
        'buyer@example.test',
        'Ada',
        invoiceData({ lines: [{ ...invoiceData().lines[0], title: '<script>alert("x")</script> & Co' }] }),
      );

      const { html } = provider.send.mock.calls[0][0];
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&amp;');
    });
  });

  describe('reliability behaviour is retained by the service, not the provider', () => {
    it('retries a transient provider failure and succeeds', async () => {
      provider.send
        .mockRejectedValueOnce(new EmailSendError('transient', MailProvider.SMTP, { code: 'ECONNECTION' }))
        .mockResolvedValueOnce({ providerId: 'msg-2' });

      await expect(service.sendVerificationEmail('user@example.test', 'A', '111111')).resolves.toBeUndefined();

      expect(provider.send).toHaveBeenCalledTimes(2);
    }, 15000);

    it('gives up after 3 attempts and rethrows so the caller can record the failure', async () => {
      provider.send.mockRejectedValue(new EmailSendError('permanent', MailProvider.SMTP, { code: 'EAUTH' }));

      await expect(
        service.sendDigitalDeliveryEmail('buyer@example.test', 'A', 'MP-1', ['Dune'], 'https://s.test/o/1'),
      ).rejects.toBeInstanceOf(EmailSendError);

      expect(provider.send).toHaveBeenCalledTimes(3);
    }, 20000);
  });

  describe('onModuleInit', () => {
    it('runs the boot-time check when the provider offers one', async () => {
      await service.onModuleInit();

      expect(provider.verifyConnection).toHaveBeenCalledTimes(1);
    });

    /**
     * A mail outage must not stop the storefront from serving traffic, so a
     * failed boot check logs loudly and returns rather than throwing.
     */
    it('does not throw when the boot-time check fails', async () => {
      provider.verifyConnection!.mockRejectedValue(
        new EmailSendError('bad credentials', MailProvider.SMTP, { code: 'EAUTH', statusCode: 535 }),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    /**
     * Resend has no connection to pre-verify. The service must skip the check
     * rather than crash on the missing optional method.
     */
    it('skips the check for a provider with no verifyConnection hook', async () => {
      await build({
        getProviderName: jest.fn().mockReturnValue(MailProvider.RESEND),
        verifyConnection: undefined,
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(provider.send).not.toHaveBeenCalled();
    });
  });
});
