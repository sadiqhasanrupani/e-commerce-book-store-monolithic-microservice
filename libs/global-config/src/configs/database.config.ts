import { registerAs } from '@nestjs/config';

/**
 * @configs related to database
 * */

export default registerAs('database', () => ({
  databaseUrl: process.env.DATABASE_URL,
  synchronize: process.env.DATABASE_SYNC === 'true',
  autoLoadEntities: process.env.DATABASE_AUTOLOAD === 'true',
}));
