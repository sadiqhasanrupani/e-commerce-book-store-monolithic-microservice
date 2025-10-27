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


  STORAGE_ENDPOINT: Joi.string().required(),
  STORAGE_PORT: Joi.number().required(),
  STORAGE_USE_SSL: Joi.boolean().required(),
  STORAGE_ACCESS_KEY: Joi.string().required(),
  STORAGE_SECRET_KEY: Joi.string().required(),
  STORAGE_BUCKET: Joi.string().required(),
  STORAGE_REGION: Joi.string().required(),


  // JWT_SCRET_KEY: Joi.string().required(),
  // JWT_TOKEN_AUDIENCE: Joi.string().required,
  // JWT_TOKEN_ISSUER: Joi.string().required(),
  // JWT_ACCESS_TOKEN_TTL: Joi.string().required(),
});
