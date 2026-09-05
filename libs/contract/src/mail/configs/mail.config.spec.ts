import * as Joi from 'joi';

import { mailEnvironmentSchema } from './mail.config';
import { MailProvider } from '../interfaces/email-provider.interface';

/**
 * The env contract for mail.
 *
 * The point of these tests is the *conditional* requirement: the old PhonePe
 * integration made four provider-specific secrets unconditionally required, so
 * deployments that had already moved to Razorpay still had to carry them just
 * to boot. Mail must not repeat that — an SMTP deployment should never be asked
 * for a Resend key, and vice versa.
 *
 * The most important case is the first one: `MAIL_PROVIDER` unset must still
 * require the SMTP block. If Joi failed to resolve the sibling `default('smtp')`
 * before evaluating `is`, every `when` below would silently take its
 * `otherwise` branch and a production deploy missing `MAIL_HOST` would boot
 * happily and then fail to send anything.
 */
describe('mailEnvironmentSchema', () => {
  // Validated in isolation; `unknown: true` because the real schema also holds
  // the database/JWT/Razorpay keys that are irrelevant here.
  const schema = Joi.object(mailEnvironmentSchema).unknown(true);

  const SMTP_BLOCK = {
    MAIL_HOST: 'smtp.example.test',
    MAIL_USER: 'mailer@example.com',
    MAIL_PASS: 'app-password',
    MAIL_FROM: 'no-reply@magicpages.com',
  };

  describe('when MAIL_PROVIDER is unset (the pre-refactor deployment)', () => {
    it('defaults the provider to smtp', () => {
      const { error, value } = schema.validate(SMTP_BLOCK);

      expect(error).toBeUndefined();
      expect(value.MAIL_PROVIDER).toBe(MailProvider.SMTP);
    });

    it('still requires the SMTP block', () => {
      const { error } = schema.validate({ ...SMTP_BLOCK, MAIL_HOST: undefined });

      expect(error?.message).toContain('"MAIL_HOST" is required');
    });

    it('does not require RESEND_API_KEY', () => {
      expect(schema.validate(SMTP_BLOCK).error).toBeUndefined();
    });

    it('defaults MAIL_PORT to 587', () => {
      expect(schema.validate(SMTP_BLOCK).value.MAIL_PORT).toBe(587);
    });
  });

  describe('when MAIL_PROVIDER=smtp', () => {
    it.each(['MAIL_HOST', 'MAIL_USER', 'MAIL_PASS'])('requires %s', (key) => {
      const { error } = schema.validate({ ...SMTP_BLOCK, MAIL_PROVIDER: 'smtp', [key]: undefined });

      expect(error?.message).toContain(`"${key}" is required`);
    });

    it('accepts a config with no Resend key at all', () => {
      expect(schema.validate({ ...SMTP_BLOCK, MAIL_PROVIDER: 'smtp' }).error).toBeUndefined();
    });
  });

  describe('when MAIL_PROVIDER=resend', () => {
    const RESEND_BLOCK = { MAIL_PROVIDER: 'resend', MAIL_FROM: SMTP_BLOCK.MAIL_FROM, RESEND_API_KEY: 're_x' };

    it('requires RESEND_API_KEY', () => {
      const { error } = schema.validate({ ...RESEND_BLOCK, RESEND_API_KEY: undefined });

      expect(error?.message).toContain('"RESEND_API_KEY" is required');
    });

    /** The anti-PhonePe-sprawl assertion: no dead SMTP secrets required. */
    it('does not require any of the SMTP variables', () => {
      expect(schema.validate(RESEND_BLOCK).error).toBeUndefined();
    });
  });

  describe('always', () => {
    it('requires MAIL_FROM — every transport needs a sender identity', () => {
      const { error } = schema.validate({ ...SMTP_BLOCK, MAIL_FROM: undefined });

      expect(error?.message).toContain('"MAIL_FROM" is required');
    });

    it('rejects MAIL_FROM that is not an email address', () => {
      const { error } = schema.validate({ ...SMTP_BLOCK, MAIL_FROM: 'not-an-email' });

      expect(error?.message).toContain('MAIL_FROM');
    });

    it('rejects an unknown MAIL_PROVIDER at boot rather than at first send', () => {
      const { error } = schema.validate({ ...SMTP_BLOCK, MAIL_PROVIDER: 'mailgun' });

      expect(error?.message).toContain('MAIL_PROVIDER');
    });
  });
});
