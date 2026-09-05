import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

import { MailProvider } from '../interfaces/email-provider.interface';

/**
 * Mail configuration, keyed by the transport selected in `MAIL_PROVIDER`.
 *
 * Moved here from `libs/global-config/src/configs/mail.config.ts` so the whole
 * mail contract — interface, DI token, config, and the env rules that back it —
 * sits in one place. `@app/contract/auth/configs/jwt.config` already
 * establishes that pattern: `libs/contract` owns the config shape and
 * `GlobalConfigModule` just loads it.
 *
 * ## Why `MAIL_PROVIDER` gates what Joi requires
 *
 * The obvious implementation is to mark every mail variable `required()` and be
 * done with it. We already know how that ends: the old PhonePe integration made
 * `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX` and
 * `PHONEPE_API_URL` unconditionally required, so every deployment — including
 * ones that had already moved to Razorpay and would never call PhonePe — had to
 * keep carrying four dead secrets just to get the app to boot. Removing PhonePe
 * meant removing that sprawl.
 *
 * So mail does not repeat it. An SMTP deployment is never asked for
 * `RESEND_API_KEY`, and a Resend deployment is never asked for `MAIL_HOST` /
 * `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS`. Only `MAIL_FROM` is required in both
 * cases, because both transports need a sender identity.
 *
 * ## Default
 *
 * `MAIL_PROVIDER` defaults to `smtp`. Existing deployments that have never
 * heard of this variable keep the exact behaviour they had before the provider
 * refactor, with zero config changes — which is the whole point: this is a
 * structural change, not a migration anyone has to schedule.
 */
export default registerAs('mail', () => ({
  /**
   * Which transport to construct. Validated to `smtp | resend` by
   * {@link mailEnvironmentSchema}; the `?? 'smtp'` is belt-and-braces for code
   * paths (unit tests, scripts) that build the config without running Joi.
   */
  provider: (process.env.MAIL_PROVIDER as MailProvider) ?? MailProvider.SMTP,

  /** Sender identity. Required for every provider. */
  from: process.env.MAIL_FROM,

  // --- SMTP block (used only when provider === 'smtp') ---
  host: process.env.MAIL_HOST,
  port: parseInt(process.env.MAIL_PORT || '587', 10),
  user: process.env.MAIL_USER,
  pass: process.env.MAIL_PASS,
  /**
   * Left as the raw string on purpose — `SmtpProvider` is what converts it,
   * because the string `"false"` is truthy and passing it through unconverted
   * would switch on implicit TLS for anyone who explicitly disabled it.
   */
  secure: process.env.MAIL_SECURE,

  // --- Resend block (used only when provider === 'resend') ---
  resendApiKey: process.env.RESEND_API_KEY,
}));

/**
 * Joi rules for the mail block, spread into the application-wide schema in
 * `libs/global-config/src/schemas/environment.schema.ts`.
 *
 * Kept next to the config it validates so the two cannot drift — adding a
 * variable above without adding a rule here would otherwise be invisible.
 *
 * Implementation note on the `when(...)` clauses: Joi resolves the sibling
 * `MAIL_PROVIDER` reference *after* applying that key's own `default('smtp')`,
 * so `is: MailProvider.SMTP` matches when the variable is absent entirely. That
 * is what makes the SMTP block stay required for deployments that never set
 * `MAIL_PROVIDER` — verified against this repo's Joi version rather than
 * assumed, because the alternative (`is` failing to match `undefined` and
 * silently taking the `otherwise` branch) would have quietly made `MAIL_HOST`
 * optional and turned a misconfigured production deploy into a runtime
 * surprise instead of a boot failure.
 */
export const mailEnvironmentSchema = {
  MAIL_PROVIDER: Joi.string()
    .valid(MailProvider.SMTP, MailProvider.RESEND)
    .default(MailProvider.SMTP)
    .description('Which mail transport to use. Defaults to smtp.'),

  /** Both transports send *from* somewhere, so this is required either way. */
  MAIL_FROM: Joi.string().email().required(),

  MAIL_HOST: Joi.string().when('MAIL_PROVIDER', {
    is: MailProvider.SMTP,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  MAIL_PORT: Joi.number().integer().default(587),
  MAIL_USER: Joi.string().when('MAIL_PROVIDER', {
    is: MailProvider.SMTP,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  MAIL_PASS: Joi.string().when('MAIL_PROVIDER', {
    is: MailProvider.SMTP,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  MAIL_SECURE: Joi.string().optional(),

  RESEND_API_KEY: Joi.string().when('MAIL_PROVIDER', {
    is: MailProvider.RESEND,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
};
