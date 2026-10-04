import { registerAs } from '@nestjs/config';

/**
 * @configs related to Space Object Storage
 * */

export default registerAs('s3', () => ({
  storageEndpoint: process.env.STORAGE_ENDPOINT,
  storagePort: process.env.STORAGE_PORT,
  storageAccessKey: process.env.STORAGE_ACCESS_KEY,
  storageSecretKey: process.env.STORAGE_SECRET_KEY,

  /**
   * The **public** bucket: catalogue imagery the storefront renders straight
   * from its stored URL (covers, snapshots, category/age-group art). It carries
   * an anonymous `s3:GetObject` bucket policy, so *everything in it is
   * world-readable by design*. Never write a paid deliverable here.
   *
   * The key is still called `storageBucket` / `STORAGE_BUCKET` because it is the
   * bucket every existing deployment already points at; only its meaning
   * narrowed (it used to hold both public and private objects).
   */
  storageBucket: process.env.STORAGE_BUCKET,

  /**
   * The **private** bucket: paid deliverables (ebook/audiobook files) and
   * archived objects. It has no bucket policy and its objects are written with
   * the `private` ACL, so an anonymous fetch is refused by storage itself —
   * the bytes are only reachable through `UploadToStorageProvider.getFile()`,
   * i.e. after the API has authorised the caller.
   *
   * Optional: defaults to `<STORAGE_BUCKET>-private` so an existing `.env`
   * keeps booting. Set it explicitly in production.
   */
  storagePrivateBucket: process.env.STORAGE_PRIVATE_BUCKET,

  storageUseSsl: process.env.STORAGE_USE_SSL === 'true',
  storageRegion: process.env.STORAGE_REGION,
}));
