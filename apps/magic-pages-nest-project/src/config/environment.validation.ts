import * as Joi from 'joi';

/**
 * Valids the environment variables
 * if they are not valid or not defined, it will throw an error
 * */
export default Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development')
    .required(),

  DATABASE_URL: Joi.string().required(),
  DATABASE_SYNC: Joi.string().required(),
  DATABASE_AUTOLOAD: Joi.string().required(),

  // JWT_SCRET_KEY: Joi.string().required(),
  // JWT_TOKEN_AUDIENCE: Joi.string().required,
  // JWT_TOKEN_ISSUER: Joi.string().required(),
  // JWT_ACCESS_TOKEN_TTL: Joi.string().required(),
});
