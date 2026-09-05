import { ConfigType } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import mailConfig from '@app/contract/mail/configs/mail.config';
import { EmailSendError, MailProvider } from '@app/contract/mail/interfaces/email-provider.interface';

import { captureEmailError } from '../mail.test-utils';
import { SmtpProvider } from './smtp.provider';

jest.mock('nodemailer');

type MailConfiguration = ConfigType<typeof mailConfig>;

const sendMail = jest.fn();
const verify = jest.fn();
const createTransport = nodemailer.createTransport as jest.MockedFunction<typeof nodemailer.createTransport>;

function buildConfig(overrides: Partial<MailConfiguration> = {}): MailConfiguration {
  return {
    provider: MailProvider.SMTP,
    from: 'Magic Pages <no-reply@magicpages.test>',
    host: 'smtp.example.test',
    port: 587,
    user: 'mailer@example.test',
    pass: 'app password here',
    secure: undefined,
    resendApiKey: undefined,
    ...overrides,
  } as MailConfiguration;
}

describe('SmtpProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createTransport.mockReturnValue({ sendMail, verify } as unknown as nodemailer.Transporter);
  });

  describe('transporter construction', () => {
    it('reports itself as the smtp provider', () => {
      expect(new SmtpProvider(buildConfig()).getProviderName()).toBe(MailProvider.SMTP);
    });

    it('passes host, port and credentials through to nodemailer', () => {
      new SmtpProvider(buildConfig());

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.test',
          port: 587,
          auth: { user: 'mailer@example.test', pass: 'apppasswordhere' },
        }),
      );
    });

    it('falls back to port 587 when MAIL_PORT is absent', () => {
      new SmtpProvider(buildConfig({ port: undefined as unknown as number }));

      expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587 }));
    });

    /**
     * The regression this guards: `secure` arrives from `process.env` as a
     * STRING, and the string "false" is truthy. Passing it through unconverted
     * would switch on implicit TLS for someone who explicitly disabled it,
     * breaking submission on port 587.
     */
    it.each([
      ['true', true],
      ['TRUE', true],
      ['false', false],
      [undefined, false],
      ['', false],
    ])('converts MAIL_SECURE=%s to secure=%s', (raw, expected) => {
      new SmtpProvider(buildConfig({ secure: raw }));

      expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: expected }));
    });
  });

  describe('send', () => {
    it('sends with the configured MAIL_FROM and returns the transport message id', async () => {
      sendMail.mockResolvedValue({ messageId: '<abc@example.test>' });

      const result = await new SmtpProvider(buildConfig()).send({
        to: 'buyer@example.test',
        subject: 'Subject line',
        html: '<p>body</p>',
      });

      expect(sendMail).toHaveBeenCalledWith({
        from: 'Magic Pages <no-reply@magicpages.test>',
        to: 'buyer@example.test',
        subject: 'Subject line',
        html: '<p>body</p>',
        text: undefined,
      });
      expect(result).toEqual({ providerId: '<abc@example.test>' });
    });

    it('forwards the optional plain-text alternative', async () => {
      sendMail.mockResolvedValue({ messageId: 'id' });

      await new SmtpProvider(buildConfig()).send({
        to: 'buyer@example.test',
        subject: 's',
        html: '<p>h</p>',
        text: 'plain',
      });

      expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ text: 'plain' }));
    });

    it('normalises a nodemailer failure into EmailSendError, keeping code and responseCode', async () => {
      const raw = Object.assign(new Error('535 Authentication failed\nmore detail'), {
        code: 'EAUTH',
        responseCode: 535,
      });
      sendMail.mockRejectedValue(raw);

      const provider = new SmtpProvider(buildConfig());

      await expect(provider.send({ to: 'a@b.test', subject: 's', html: 'h' })).rejects.toBeInstanceOf(EmailSendError);

      // Re-run to inspect the normalised error rather than the raw SDK one.
      const error = await captureEmailError(provider.send({ to: 'a@b.test', subject: 's', html: 'h' }));

      expect(error.provider).toBe(MailProvider.SMTP);
      expect(error.code).toBe('EAUTH');
      expect(error.statusCode).toBe(535);
      // Only the first line of the SDK message survives — no multi-line dumps in logs.
      expect(error.message).toBe('SMTP send failed: 535 Authentication failed');
      expect(error.message).not.toContain('more detail');
    });

    it('never lets the raw SDK error escape', async () => {
      sendMail.mockRejectedValue(new Error('socket hang up'));

      await expect(
        new SmtpProvider(buildConfig()).send({ to: 'a@b.test', subject: 's', html: 'h' }),
      ).rejects.toMatchObject({ name: 'EmailSendError', provider: MailProvider.SMTP });
    });
  });

  describe('verifyConnection', () => {
    it('resolves when nodemailer verifies the transport', async () => {
      verify.mockResolvedValue(true);

      await expect(new SmtpProvider(buildConfig()).verifyConnection()).resolves.toBeUndefined();
      expect(verify).toHaveBeenCalledTimes(1);
    });

    it.each(['host', 'user', 'pass'] as const)(
      'throws without opening a socket when MAIL_%s is missing',
      async (key) => {
        const provider = new SmtpProvider(buildConfig({ [key]: undefined }));

        const error = await captureEmailError(provider.verifyConnection());

        expect(error).toBeInstanceOf(EmailSendError);
        expect(error.code).toBe('ECONFIG');
        expect(error.message).toContain('MAIL_HOST / MAIL_USER / MAIL_PASS are missing');
        expect(verify).not.toHaveBeenCalled();
      },
    );

    it('normalises an authentication failure and names the env keys to fix', async () => {
      verify.mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 }));

      const error = await captureEmailError(new SmtpProvider(buildConfig()).verifyConnection());

      expect(error).toBeInstanceOf(EmailSendError);
      expect(error.code).toBe('EAUTH');
      expect(error.statusCode).toBe(535);
      expect(error.message).toContain('MAIL_USER / MAIL_PASS');
    });

    it('does not put the SMTP password in the error message', async () => {
      verify.mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }));

      const error = await captureEmailError(new SmtpProvider(buildConfig({ pass: 'sup3rs3cret' })).verifyConnection());

      expect(error.message).not.toContain('sup3rs3cret');
    });
  });
});
