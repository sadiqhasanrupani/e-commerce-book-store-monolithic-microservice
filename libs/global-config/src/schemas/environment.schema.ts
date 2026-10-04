import * as Joi from 'joi';

import { mailEnvironmentSchema } from '@app/contract/mail/configs/mail.config';
import { shippingEnvironmentSchema } from '@app/contract/carts/configs/shipping.config';

/**
 * Validates and enforces required environment variables at application startup.
 * If any required variable is missing or invalid, NestJS will throw an error.
 */
export default Joi.object({
  /**
   * Application Environment
   */
  NODE_ENV: Joi.string().valid('development', 'production', 'test', 'staging').default('development').required(),

  /**
   * Database Configuration
   */
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_SYNC: Joi.boolean().truthy('true').falsy('false').required(),
  DATABASE_AUTOLOAD: Joi.boolean().truthy('true').falsy('false').required(),

  /**
   * Object Storage (DigitalOcean Spaces / S3)
   */
  STORAGE_ENDPOINT: Joi.string().required(),
  STORAGE_PORT: Joi.number().integer().min(1).required(),
  STORAGE_USE_SSL: Joi.boolean().truthy('true').falsy('false').required(),
  STORAGE_ACCESS_KEY: Joi.string().required(),
  STORAGE_SECRET_KEY: Joi.string().required(),
  STORAGE_BUCKET: Joi.string().required(),

  /**
   * Second bucket for non-public objects (paid deliverables, archived files).
   *
   * Optional so that an existing `.env` still boots: when it is absent the
   * upload provider derives `<STORAGE_BUCKET>-private`. It is validated as a
   * plain string rather than required because the fallback is safe (a *private*
   * bucket), and a missing value must never be able to make deliverables land
   * in the world-readable bucket.
   */
  STORAGE_PRIVATE_BUCKET: Joi.string().optional(),

  STORAGE_REGION: Joi.string().required(),

  /**
   * JWT Configuration
   */
  JWT_SECRET_KEY: Joi.string().min(32).required(),
  JWT_TOKEN_AUDIENCE: Joi.string().required(),
  JWT_TOKEN_ISSUER: Joi.string().required(),
  JWT_ACCESS_TOKEN_TTL: Joi.string().default('1h').required(),

  /**
   * Hashing / Encryption Configuration
   * Controls the algorithm used for password hashing (bcrypt or argon2)
   */
  HASH_ALGO: Joi.string()
    .valid('bcrypt', 'argon2')
    .default('bcrypt')
    .description('Select which algorithm to use for password hashing'),

  // bcrypt options
  BCRYPT_SALT_ROUNDS: Joi.number().integer().min(6).max(15).default(10).when('HASH_ALGO', {
    is: 'bcrypt',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // argon2 options
  ARGON2_MEMORY_COST: Joi.number()
    .integer()
    .min(8192)
    .max(262144) // 8MB–256MB
    .default(65536)
    .when('HASH_ALGO', {
      is: 'argon2',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),

  ARGON2_TIME_COST: Joi.number().integer().min(1).max(10).default(5).when('HASH_ALGO', {
    is: 'argon2',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  ARGON2_PARALLELISM: Joi.number().integer().min(1).max(4).default(2).when('HASH_ALGO', {
    is: 'argon2',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  /**
   * Redis Configuration
   */
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().integer().min(1).max(65535).default(6379),

  /**
   * Mail Configuration
   *
   * Spread in from `@app/contract/mail/configs/mail.config` so the rules live
   * beside the config object they validate. `MAIL_PROVIDER` (smtp | resend,
   * default smtp) decides which block is required: an SMTP deployment is never
   * asked for `RESEND_API_KEY`, and a Resend deployment is never asked for
   * `MAIL_HOST` / `MAIL_USER` / `MAIL_PASS`.
   */
  ...mailEnvironmentSchema,

  /**
   * Razorpay Payment Gateway
   */
  RAZORPAY_KEY_ID: Joi.string().required(),
  RAZORPAY_KEY_SECRET: Joi.string().required(),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().optional(),

  /**
   * Shipping
   *
   * `SHIPPING_FLAT_RATE_PAISE` — the single flat rate charged on any order
   * containing a physical line. Optional, defaults to 0 (no shipping charged),
   * which preserves the pre-existing behaviour on a deployment that has not set
   * it yet.
   */
  ...shippingEnvironmentSchema,
});
