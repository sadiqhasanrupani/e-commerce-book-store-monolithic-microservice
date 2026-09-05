import { ConfigType } from '@nestjs/config';

import mailConfig from '@app/contract/mail/configs/mail.config';
import { EmailSendError, IEmailProvider, MailProvider } from '@app/contract/mail/interfaces/email-provider.interface';

const send = jest.fn();
const resendConstructor = jest.fn();

/**
 * The Resend SDK is mocked because there is no test API key — a live key is
 * deployment configuration and never reaches this repo. These tests therefore
 * verify that the ADAPTER is written correctly against Resend's documented
 * response contract; they cannot prove Resend accepts our messages. That first
 * live send has to happen in a real environment with a real
 * `RESEND_API_KEY`.
 */
jest.mock('resend', () => ({
  Resend: class {
    emails = { send };
    constructor(apiKey?: string) {
      resendConstructor(apiKey);
    }
  },
}));

// Imported after the mock is registered.
import { captureEmailError } from '../mail.test-utils';
import { ResendProvider } from './resend.provider';

type MailConfiguration = ConfigType<typeof mailConfig>;

function buildConfig(overrides: Partial<MailConfiguration> = {}): MailConfiguration {
  return {
    provider: MailProvider.RESEND,
    from: 'Magic Pages <no-reply@magicpages.test>',
    host: undefined,
    port: 587,
    user: undefined,
    pass: undefined,
    secure: undefined,
    resendApiKey: 're_test_key',
    ...overrides,
  } as MailConfiguration;
}

describe('ResendProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports itself as the resend provider', () => {
    expect(new ResendProvider(buildConfig()).getProviderName()).toBe(MailProvider.RESEND);
  });

  it('constructs the SDK client with RESEND_API_KEY', () => {
    new ResendProvider(buildConfig());

    expect(resendConstructor).toHaveBeenCalledWith('re_test_key');
  });

  /**
   * Resend is a stateless HTTPS API with nothing to pre-verify, so the optional
   * hook is deliberately absent and `MailService` skips the boot check. If
   * someone adds one, they need to have thought about what it does on every
   * boot — this asserts the absence is a decision, not an oversight.
   */
  it('exposes no verifyConnection hook', () => {
    const provider: IEmailProvider = new ResendProvider(buildConfig());

    expect(provider.verifyConnection).toBeUndefined();
  });

  describe('send', () => {
    it('maps params onto the Resend API shape and returns the email id', async () => {
      send.mockResolvedValue({ data: { id: 'email-123' }, error: null });

      const result = await new ResendProvider(buildConfig()).send({
        to: 'buyer@example.test',
        subject: 'Your download is ready',
        html: '<p>body</p>',
        text: 'body',
      });

      expect(send).toHaveBeenCalledWith({
        from: 'Magic Pages <no-reply@magicpages.test>',
        to: 'buyer@example.test',
        subject: 'Your download is ready',
        html: '<p>body</p>',
        text: 'body',
      });
      expect(result).toEqual({ providerId: 'email-123' });
    });

    it('omits text entirely when no plain-text alternative is supplied', async () => {
      send.mockResolvedValue({ data: { id: 'email-123' }, error: null });

      await new ResendProvider(buildConfig()).send({ to: 'a@b.test', subject: 's', html: '<p>h</p>' });

      expect(send).toHaveBeenCalledWith(expect.not.objectContaining({ text: expect.anything() }));
    });

    /**
     * THE important test.
     *
     * `resend.emails.send()` resolves — it does not reject — when the API
     * rejects the message. If the adapter returned normally here, `@Retry` and
     * the circuit breaker in `MailService` would see a success, and
     * `DigitalDeliveryService` would mark the order line SENT for an email that
     * was never delivered.
     */
    it('throws when the API rejects the message despite the promise resolving', async () => {
      send.mockResolvedValue({
        data: null,
        error: { message: 'The magicpages.test domain is not verified.', name: 'validation_error', statusCode: 403 },
      });

      const provider = new ResendProvider(buildConfig());

      await expect(provider.send({ to: 'a@b.test', subject: 's', html: 'h' })).rejects.toBeInstanceOf(EmailSendError);

      const error = await captureEmailError(provider.send({ to: 'a@b.test', subject: 's', html: 'h' }));

      expect(error.provider).toBe(MailProvider.RESEND);
      expect(error.code).toBe('validation_error');
      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('The magicpages.test domain is not verified.');
    });

    it('normalises a rate-limit rejection the same way', async () => {
      send.mockResolvedValue({
        data: null,
        error: { message: 'Too many requests.', name: 'rate_limit_exceeded', statusCode: 429 },
      });

      const error = await captureEmailError(
        new ResendProvider(buildConfig()).send({ to: 'a@b.test', subject: 's', html: 'h' }),
      );

      expect(error.code).toBe('rate_limit_exceeded');
      expect(error.statusCode).toBe(429);
    });

    it('normalises a transport-level rejection into the same error type', async () => {
      send.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.resend.com'));

      const error = await captureEmailError(
        new ResendProvider(buildConfig()).send({ to: 'a@b.test', subject: 's', html: 'h' }),
      );

      expect(error).toBeInstanceOf(EmailSendError);
      expect(error.provider).toBe(MailProvider.RESEND);
      expect(error.code).toBe('ETRANSPORT');
    });

    it('refuses to report success when the API returns neither an id nor an error', async () => {
      send.mockResolvedValue({ data: null, error: null });

      const error = await captureEmailError(
        new ResendProvider(buildConfig()).send({ to: 'a@b.test', subject: 's', html: 'h' }),
      );

      expect(error).toBeInstanceOf(EmailSendError);
      expect(error.code).toBe('EMALFORMED');
    });

    it('fails loudly rather than sending when MAIL_FROM is missing', async () => {
      const error = await captureEmailError(
        new ResendProvider(buildConfig({ from: undefined })).send({ to: 'a@b.test', subject: 's', html: 'h' }),
      );

      expect(error).toBeInstanceOf(EmailSendError);
      expect(error.code).toBe('ECONFIG');
      expect(send).not.toHaveBeenCalled();
    });

    it('does not put the API key in the error message', async () => {
      send.mockResolvedValue({
        data: null,
        error: { message: 'Invalid API key', name: 'validation_error', statusCode: 401 },
      });

      const error = await captureEmailError(
        new ResendProvider(buildConfig({ resendApiKey: 're_super_secret' })).send({
          to: 'a@b.test',
          subject: 's',
          html: 'h',
        }),
      );

      expect(error.message).not.toContain('re_super_secret');
    });
  });
});
