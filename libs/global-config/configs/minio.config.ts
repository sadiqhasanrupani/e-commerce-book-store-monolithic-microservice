import { registerAs } from '@nestjs/config';

/**
 * @configs related to Space Object Storage
 * */

export default registerAs('s3', () => ({
  storageEndpoint: process.env.STORAGE_ENDPOINT,
  storagePort: process.env.STORAGE_PORT,
  storageAccessKey: process.env.STORAGE_ACCESS_KEY,
  storageSecretKey: process.env.STORAGE_SECRET_KEY,
  storageBucket: process.env.STORAGE_BUCKET,
  storageUseSsl: process.env.STORAGE_USE_SSL === 'true',
  storageRegion: process.env.STORAGE_REGION,
}));
