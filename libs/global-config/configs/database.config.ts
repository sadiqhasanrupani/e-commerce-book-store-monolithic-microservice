import { registerAs } from '@nestjs/config';

/**
 * @configs related to database
 * */

export default registerAs('database', () => ({
  databaseUrl: process.env.DATABASE_URL,
  databaseName: process.env.DATABASE_NAME,
  databaseUsername: process.env.DATABASE_USERNAME,
  databasePassword: process.env.DATABASE_PASSWORD || '',
  databasePort: process.env.DATABASE_PORT,
  databaseHost: process.env.DATABASE_HOST,
  synchronize: process.env.DATABASE_SYNC === 'true',
  autoLoadEntities: process.env.DATABASE_AUTOLOAD === 'true',
}));
