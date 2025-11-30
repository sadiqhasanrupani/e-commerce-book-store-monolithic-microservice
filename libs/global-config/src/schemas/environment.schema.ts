import * as Joi from 'joi';

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
   */
  MAIL_HOST: Joi.string().required(),
  MAIL_PORT: Joi.number().integer().default(587),
  MAIL_USER: Joi.string().required(),
  MAIL_PASS: Joi.string().required(),
  MAIL_FROM: Joi.string().email().required(),
});
