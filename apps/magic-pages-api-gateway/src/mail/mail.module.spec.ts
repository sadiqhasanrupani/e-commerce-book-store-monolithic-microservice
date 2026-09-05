import { ConfigType } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import mailConfig from '@app/contract/mail/configs/mail.config';
import { MailProvider } from '@app/contract/mail/interfaces/email-provider.interface';

jest.mock('nodemailer');

const resendSend = jest.fn();
const resendConstructor = jest.fn();

jest.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
    constructor(apiKey?: string) {
      resendConstructor(apiKey);
    }
  },
}));

import { createEmailProvider } from './mail.module';
import { SmtpProvider } from './providers/smtp.provider';
import { ResendProvider } from './providers/resend.provider';

type MailConfiguration = ConfigType<typeof mailConfig>;

const createTransport = nodemailer.createTransport as jest.MockedFunction<typeof nodemailer.createTransport>;

function buildConfig(overrides: Partial<MailConfiguration> = {}): MailConfiguration {
  return {
    provider: MailProvider.SMTP,
    from: 'no-reply@magicpages.test',
    host: 'smtp.example.test',
    port: 587,
    user: 'mailer@example.test',
    pass: 'secret',
    secure: undefined,
    resendApiKey: 're_test_key',
    ...overrides,
  } as MailConfiguration;
}

/**
 * The provider-selection rule. This is the guard on the promise that the
 * refactor changes nothing in production until someone deliberately sets
 * `MAIL_PROVIDER=resend`.
 */
describe('createEmailProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createTransport.mockReturnValue({ sendMail: jest.fn(), verify: jest.fn() } as unknown as nodemailer.Transporter);
  });

  it('selects SMTP when MAIL_PROVIDER is unset — existing deployments are untouched', () => {
    const provider = createEmailProvider(buildConfig({ provider: undefined }));

    expect(provider).toBeInstanceOf(SmtpProvider);
    expect(provider.getProviderName()).toBe(MailProvider.SMTP);
  });

  it('selects SMTP when MAIL_PROVIDER=smtp', () => {
    expect(createEmailProvider(buildConfig({ provider: MailProvider.SMTP }))).toBeInstanceOf(SmtpProvider);
  });

  it('selects Resend when MAIL_PROVIDER=resend', () => {
    const provider = createEmailProvider(buildConfig({ provider: MailProvider.RESEND }));

    expect(provider).toBeInstanceOf(ResendProvider);
    expect(provider.getProviderName()).toBe(MailProvider.RESEND);
  });

  it('falls back to SMTP for an unrecognised value rather than leaving the app with no transport', () => {
    const provider = createEmailProvider(buildConfig({ provider: 'mailgun' as MailProvider }));

    expect(provider).toBeInstanceOf(SmtpProvider);
  });

  /**
   * Both adapters build a client in their constructor. Instantiating the
   * unselected one would open a pointless nodemailer transporter, or construct
   * a Resend client with an undefined API key and log a warning about it, on
   * every boot of a perfectly healthy deployment.
   */
  describe('constructs only the selected provider', () => {
    it('does not build a Resend client when SMTP is selected', () => {
      createEmailProvider(buildConfig({ provider: MailProvider.SMTP }));

      expect(createTransport).toHaveBeenCalledTimes(1);
      expect(resendConstructor).not.toHaveBeenCalled();
    });

    it('does not build an SMTP transporter when Resend is selected', () => {
      createEmailProvider(buildConfig({ provider: MailProvider.RESEND }));

      expect(resendConstructor).toHaveBeenCalledTimes(1);
      expect(createTransport).not.toHaveBeenCalled();
    });
  });
});
