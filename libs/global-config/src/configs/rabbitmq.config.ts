import { registerAs } from '@nestjs/config';

/**
 * @config for rabbitmq
 * */
export default registerAs('rabbitmq', () => ({
  url: process.env.RABBITMQ_URL,
  queue: process.env.RABBITMQ_QUEUE,
}));
