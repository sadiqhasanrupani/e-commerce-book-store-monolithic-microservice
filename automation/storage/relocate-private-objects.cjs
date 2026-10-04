#!/usr/bin/env node
/**
 * One-shot migration: move non-image objects out of the PUBLIC bucket.
 *
 * Why this exists
 * ---------------
 * Object storage used to be a single bucket holding both catalogue imagery and
 * paid deliverables, separated only by a per-object ACL. The application now
 * splits them across two buckets (`STORAGE_BUCKET` = public, world-readable by
 * bucket policy; `STORAGE_PRIVATE_BUCKET` = credentials-only), but objects that
 * were written *before* that change are still sitting in the public bucket.
 *
 * That matters more than it looks: MinIO does not enforce per-object ACLs, so
 * on a local dev stack the old bucket's contents become anonymously readable the
 * moment the app applies the public-read bucket policy at boot. Any legacy ebook
 * or audiobook in there is then a free download. This script relocates them.
 *
 * It is safe to run repeatedly, and it does NOT touch the database: a stored
 * `fileUrl` still naming the old bucket keeps working, because
 * `UploadToStorageProvider.getFile()` probes the private bucket first and falls
 * back to the public one.
 *
 * Usage
 * -----
 *   # dry run (default) — prints what would move, changes nothing
 *   node automation/storage/relocate-private-objects.cjs
 *
 *   # actually move
 *   node automation/storage/relocate-private-objects.cjs --apply
 *
 * Configuration comes from the same env vars the app uses:
 *   STORAGE_ENDPOINT, STORAGE_PORT, STORAGE_REGION,
 *   STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY,
 *   STORAGE_BUCKET, STORAGE_PRIVATE_BUCKET
 *
 * Run it with the env of the deployment you are fixing, e.g.
 *   env $(grep -v '^#' .env | xargs) node automation/storage/relocate-private-objects.cjs --apply
 */

const {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const APPLY = process.argv.includes('--apply');

const rawEndpoint = process.env.STORAGE_ENDPOINT || 'localhost';
const port = process.env.STORAGE_PORT || '9000';
const endpoint = rawEndpoint.startsWith('http') ? rawEndpoint : `http://${rawEndpoint}:${port}`;

const publicBucket = process.env.STORAGE_BUCKET;
const privateBucket = process.env.STORAGE_PRIVATE_BUCKET || (publicBucket ? `${publicBucket}-private` : undefined);

if (!publicBucket || !privateBucket || publicBucket === privateBucket) {
  console.error('STORAGE_BUCKET and STORAGE_PRIVATE_BUCKET must be set to two different buckets.');
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.STORAGE_REGION || 'us-east-1',
  endpoint,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY || '',
    secretAccessKey: process.env.STORAGE_SECRET_KEY || '',
  },
  forcePathStyle: true,
});

/** Extensions we accept as catalogue imagery when the stored content type is unhelpful. */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg'];

/**
 * Mirrors `defaultVisibilityFor` in the upload provider: images are the only
 * asset class the storefront fetches straight from storage, so everything else
 * belongs in the private bucket. Content type wins; the extension is the
 * fallback for objects stored without one.
 */
function belongsInPublicBucket(key, contentType) {
  if (contentType && contentType !== 'application/octet-stream') {
    return contentType.toLowerCase().startsWith('image/');
  }

  const lower = key.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function* listAll(bucket) {
  let token;

  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const object of page.Contents ?? []) yield object;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

(async () => {
  console.log(`${APPLY ? 'MOVING' : 'DRY RUN'}: ${publicBucket} → ${privateBucket} (${endpoint})\n`);

  const kept = [];
  const moved = [];
  const failed = [];

  for await (const object of listAll(publicBucket)) {
    const key = object.Key;

    let contentType;
    try {
      contentType = (await s3.send(new HeadObjectCommand({ Bucket: publicBucket, Key: key }))).ContentType;
    } catch {
      contentType = undefined;
    }

    if (belongsInPublicBucket(key, contentType)) {
      kept.push(`${key} (${contentType || 'unknown'})`);
      continue;
    }

    if (!APPLY) {
      moved.push(`${key} (${contentType || 'unknown'})`);
      continue;
    }

    try {
      await s3.send(
        new CopyObjectCommand({
          Bucket: privateBucket,
          CopySource: `${publicBucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
          Key: key,
          ACL: 'private',
        }),
      );

      // Delete only after the copy succeeded, so a failure never loses the file.
      await s3.send(new DeleteObjectCommand({ Bucket: publicBucket, Key: key }));

      moved.push(`${key} (${contentType || 'unknown'})`);
    } catch (err) {
      failed.push(`${key}: ${err.name || err.message}`);
    }
  }

  console.log(`Left in the public bucket (${kept.length}):`);
  kept.forEach((line) => console.log(`  · ${line}`));

  console.log(`\n${APPLY ? 'Moved' : 'Would move'} to the private bucket (${moved.length}):`);
  moved.forEach((line) => console.log(`  → ${line}`));

  if (failed.length) {
    console.log(`\nFailed (${failed.length}):`);
    failed.forEach((line) => console.log(`  ✗ ${line}`));
    process.exitCode = 1;
  }

  if (!APPLY) console.log('\nNothing changed. Re-run with --apply to perform the move.');
})();
