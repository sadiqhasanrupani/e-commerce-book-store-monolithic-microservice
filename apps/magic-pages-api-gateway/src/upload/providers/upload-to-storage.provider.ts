import { Injectable, Logger, BadRequestException, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  GetBucketPolicyCommand,
} from '@aws-sdk/client-s3';

import {
  DeleteFilesRequest,
  DeleteFilesResponse,
  MoveFilesRequest,
  MoveFilesResponse,
} from '@app/contract/storage/types/storage.type';

type UploadType = 'photo' | 'pdf' | 'xls' | 'other';

/**
 * Who is allowed to fetch an object straight from object storage.
 *
 * This is now a **bucket** selector, not just an ACL selector:
 *
 * - `public`  → written to the public bucket (`s3.storageBucket`), which carries
 *               an anonymous `s3:GetObject` policy. The URL is a permanent,
 *               credential-free handle on the bytes. Only ever correct for
 *               catalogue imagery that the storefront renders in an `<img>` tag
 *               (covers, snapshots, category/age-group art).
 * - `private` → written to the private bucket (`s3.storagePrivateBucket`), which
 *               has no anonymous policy at all. The object can only be read by
 *               something holding the bucket credentials, which in this codebase
 *               means `getFile()` — i.e. the API streams it out after it has
 *               authorised the caller.
 *
 * Paid deliverables (the ebook/audiobook file behind a digital variant) MUST be
 * `private`: a publicly readable deliverable makes the entire paywall decorative,
 * because anyone who ever sees the URL has a permanent, forwardable copy.
 *
 * Splitting the two asset classes across two buckets rather than relying on
 * per-object ACLs inside one bucket buys two things:
 *
 *  1. **An auditable boundary.** "Does the private bucket contain anything
 *     world-readable?" is answered by looking at one bucket policy, instead of
 *     enumerating every object's ACL and hoping none of them drifted.
 *  2. **Defense in depth.** If application code ever forgets to gate a read, or
 *     a write forgets to pass a visibility, the private bucket still refuses the
 *     anonymous request at the storage layer.
 *
 * Bucket count is not a cost lever on the production target: one DigitalOcean
 * Spaces subscription covers up to 100 buckets pooled under the same storage and
 * transfer allowance.
 */
export type ObjectVisibility = 'public' | 'private';

/**
 * The per-object ACL is still set, as a second layer under the bucket policy.
 *
 * It matters because DigitalOcean Spaces refuses `PutBucketPolicy` on buckets
 * reached with a *limited-access* (per-bucket) key. If policy application fails
 * for that reason, `public-read` objects in the public bucket are still readable
 * and the storefront keeps working; the private bucket, meanwhile, never wanted
 * a policy in the first place and its objects stay `private` either way.
 */
const ACL_BY_VISIBILITY: Record<ObjectVisibility, 'public-read' | 'private'> = {
  public: 'public-read',
  private: 'private',
};

/**
 * Anonymous read policy applied to the public bucket on boot.
 *
 * `Principal: '*'` + `s3:GetObject` on `arn:aws:s3:::<bucket>/*` is the shape
 * both MinIO and DigitalOcean Spaces document for "anyone may download objects
 * from this bucket". Note it grants *GetObject only* — not `ListBucket`, so the
 * bucket cannot be enumerated anonymously.
 */
function publicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadGetObject',
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

/**
 * Fallback visibility when a caller does not state one.
 *
 * Images are the only asset class the storefront fetches directly from storage,
 * so images default to public and *everything else defaults to private*. This is
 * deliberately fail-closed: a new caller that forgets to pass a visibility gets a
 * private object (a broken download at worst) rather than a publicly readable one
 * (a leaked paid product).
 */
function defaultVisibilityFor(contentType?: string): ObjectVisibility {
  return contentType?.toLowerCase().startsWith('image/') ? 'public' : 'private';
}

/**
 * The single in-process owner of S3/MinIO object operations.
 *
 * This used to be two classes with the same name: this one (upload/download for
 * the generic `/upload` endpoint) and a second copy inside the `storage`
 * NestJS microservice, reached over TCP on port 3002. The microservice added
 * nothing but a network hop and a second process to run, so it was folded back
 * in here — `uploadFileFromBuffer`, `getFile`, `deleteFiles` and
 * `handleMoveFiles` below are ported verbatim from it so callers see identical
 * behaviour (same object keys, same returned URLs).
 *
 * The one behaviour that is *not* identical is where objects land. Every write
 * here used to go to one bucket with a `public-read` ACL, which handed out a
 * permanent credential-free URL for every object — including paid ebook files.
 * Writes now carry an explicit {@link ObjectVisibility} that selects a *bucket*:
 * catalogue imagery goes to the public bucket so the storefront can render it,
 * and deliverables go to the private bucket, reachable only through `getFile`,
 * behind an API route that has authorised the caller.
 */
@Injectable()
export class UploadToStorageProvider implements OnModuleInit {
  private readonly logger = new Logger(UploadToStorageProvider.name);
  private readonly s3: S3Client;

  /** World-readable bucket. Catalogue imagery only. */
  private readonly publicBucket: string;

  /** Credentials-only bucket. Paid deliverables and archived objects. */
  private readonly privateBucket: string;

  private readonly endpoint: string;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    const rawEndpoint = this.configService.get<string>('s3.storageEndpoint') || '';
    const port = this.configService.get<string>('s3.storagePort') || '9000';

    this.endpoint = rawEndpoint.startsWith('http') ? rawEndpoint : `http://${rawEndpoint}:${port}`;

    this.publicBucket = this.configService.get<string>('s3.storageBucket') || '';

    // Fall back to a *derived private* name rather than to the public bucket:
    // a missing STORAGE_PRIVATE_BUCKET must never be able to send deliverables
    // into the world-readable bucket. An empty public bucket name (storage not
    // configured at all) yields an empty private name too, which the guards in
    // `uploadFile` already report as a configuration error.
    this.privateBucket =
      this.configService.get<string>('s3.storagePrivateBucket') ||
      (this.publicBucket ? `${this.publicBucket}-private` : '');

    this.region = this.configService.get<string>('s3.storageRegion') || 'us-east-1';

    const accessKeyId = this.configService.get<string>('s3.storageAccessKey') || '';
    const secretAccessKey = this.configService.get<string>('s3.storageSecretKey') || '';

    this.s3 = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });

    if (!accessKeyId || !secretAccessKey || !this.publicBucket) {
      this.logger.warn('Storage configuration is missing or incomplete. File uploads will fail.');
    } else {
      this.logger.log(`S3 Client configured:
        Endpoint: ${this.endpoint}
        Public bucket:  ${this.publicBucket}
        Private bucket: ${this.privateBucket}
        Region: ${this.region}
      `);
    }

    if (this.publicBucket && this.publicBucket === this.privateBucket) {
      // Collapsing the two names back into one silently reinstates the exact
      // bug this split exists to prevent, so it is an error rather than a warn.
      this.logger.error(
        `STORAGE_BUCKET and STORAGE_PRIVATE_BUCKET are both "${this.publicBucket}". ` +
          'Private objects would land in the world-readable bucket. Point them at different buckets.',
      );
    }
  }

  /** The bucket a given visibility writes to. */
  private bucketFor(visibility: ObjectVisibility): string {
    return visibility === 'public' ? this.publicBucket : this.privateBucket;
  }

  /** Every bucket this provider owns, public first. */
  private get buckets(): string[] {
    return [this.publicBucket, this.privateBucket].filter(Boolean);
  }

  async onModuleInit() {
    if (!this.publicBucket) return;

    await this.createBucketIfNotExists(this.publicBucket);
    await this.createBucketIfNotExists(this.privateBucket);

    // Only after both buckets exist: publish one, audit the other.
    await this.applyPublicReadPolicy(this.publicBucket);
    await this.assertNoBucketPolicy(this.privateBucket);
  }

  private async createBucketIfNotExists(bucket: string) {
    if (!bucket) return;

    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: bucket }));
      this.logger.log(`Bucket "${bucket}" exists.`);
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        this.logger.log(`Bucket "${bucket}" not found. Creating...`);
        try {
          await this.s3.send(new CreateBucketCommand({ Bucket: bucket }));
          this.logger.log(`Bucket "${bucket}" created successfully.`);
        } catch (createErr) {
          this.logger.error(`Failed to create bucket "${bucket}":`, createErr);
        }
      } else {
        this.logger.error(`Error checking bucket "${bucket}":`, err);
      }
    }
  }

  /**
   * Make the public bucket anonymously readable at the *bucket* level.
   *
   * Failure is logged, never fatal. On DigitalOcean Spaces a limited-access
   * (per-bucket) key cannot call `PutBucketPolicy` at all, and some operators
   * prefer to manage the policy out-of-band via Terraform; in both cases the
   * per-object `public-read` ACL still keeps imagery servable, so refusing to
   * boot would be a worse outcome than a loud warning.
   */
  private async applyPublicReadPolicy(bucket: string) {
    if (!bucket || bucket === this.privateBucket) return;

    try {
      await this.s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: publicReadPolicy(bucket) }));
      this.logger.log(`Bucket "${bucket}" is anonymously readable (s3:GetObject policy applied).`);
    } catch (err) {
      this.logger.warn(
        `Could not apply the public-read policy to "${bucket}" (${err?.name ?? 'unknown error'}). ` +
          'Objects still carry a public-read ACL, so the storefront should keep working — ' +
          'but set the bucket policy manually if catalogue images 403.',
      );
    }
  }

  /**
   * Boot-time audit: the private bucket must not carry a bucket policy.
   *
   * This does not *remove* a policy it finds. Deleting one could clobber a
   * deliberate ops-managed rule (a CDN or IP allowlist), which is not this
   * process's call to make — but an unexplained policy on the deliverables
   * bucket is exactly the thing someone needs to see in the boot log.
   */
  private async assertNoBucketPolicy(bucket: string) {
    if (!bucket) return;

    try {
      const result = await this.s3.send(new GetBucketPolicyCommand({ Bucket: bucket }));

      if (result?.Policy) {
        this.logger.error(
          `Private bucket "${bucket}" has a bucket policy attached. It is supposed to have none — ` +
            'review it now, because a policy here can make paid deliverables anonymously readable.',
        );
      }
    } catch (err) {
      // "No policy" is reported as an error by S3-compatible stores
      // (NoSuchBucketPolicy) — that is the state we want, so it is not logged.
      const name = err?.name ?? '';
      if (name !== 'NoSuchBucketPolicy' && err?.$metadata?.httpStatusCode !== 404) {
        this.logger.debug(`Could not read the bucket policy of "${bucket}" (${name || 'unknown error'}).`);
      }
    }
  }

  /**
   * Build the stored URL for an object.
   *
   * Two shapes, exactly as before, now parameterised by bucket: virtual-host
   * style in production (`https://<bucket>.<host>/<key>`, what Spaces serves)
   * and path style everywhere else (`<endpoint>/<bucket>/<key>`, what MinIO
   * serves). The bucket is part of the URL either way, which is what lets
   * `resolveObjectLocationFromUrl` route a read back to the right bucket.
   */
  private buildObjectUrl(bucket: string, key: string): string {
    return this.configService.get<string>('NODE_ENV') === 'production'
      ? `https://${bucket}.${this.endpoint.replace(/^https?:\/\//, '')}/${key}`
      : `${this.endpoint}/${bucket}/${key}`;
  }

  /**
   * Upload a single file to S3-compatible storage.
   *
   * This backs the generic admin `POST /admin/upload` endpoint, which the admin
   * panel uses for catalogue imagery (book covers, category and age-group art).
   * Visibility is therefore derived from the content type: images go to the
   * public bucket so the storefront can render them, and anything else — a PDF
   * someone uploads here and later pins to a variant as `fileUrl`, for instance —
   * lands in the private bucket and can only be served through an authorised
   * API read.
   *
   * @param visibility optional override; omit to let the content type decide.
   */
  async uploadFile(
    file: Express.Multer.File,
    type: UploadType = 'other',
    visibility?: ObjectVisibility,
  ): Promise<string> {
    try {
      if (!file) throw new BadRequestException('File is required');

      if (!this.publicBucket || !this.configService.get<string>('s3.storageAccessKey')) {
        throw new InternalServerErrorException('Storage configuration is missing. Please check STORAGE_BUCKET, STORAGE_ACCESS_KEY, and STORAGE_SECRET_KEY.');
      }

      this.validateFileType(file, type);

      const fileName = this.generateFileName(file, type);

      this.logger.debug(`File details: originalname=${file.originalname}, mimetype=${file.mimetype}, size=${file.size}, bufferLength=${file.buffer?.length}`);

      const effectiveVisibility = visibility ?? defaultVisibilityFor(file.mimetype);
      const bucket = this.bucketFor(effectiveVisibility);

      const uploadParams: PutObjectCommandInput = {
        Bucket: bucket,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: ACL_BY_VISIBILITY[effectiveVisibility],
      };

      this.logger.log(`Uploading file: ${file.originalname} as ${fileName}`);
      this.logger.debug(`Upload params: Bucket=${bucket}, Key=${fileName}, ContentType=${file.mimetype}, ACL=${uploadParams.ACL}`);

      const result = await this.s3.send(new PutObjectCommand(uploadParams));
      this.logger.debug(`S3 upload result: ${JSON.stringify(result)}`);

      const url = this.buildObjectUrl(bucket, fileName);

      this.logger.log(`✅ Successfully uploaded: ${url}`);
      return url;
    } catch (err) {
      this.logger.error(`Error in uploadFile: ${err.message}`, err.stack);
      throw new InternalServerErrorException(`S3 Upload Failed: ${err.message} (Code: ${err.Code || 'Unknown'})`);
    }
  }

  /**
   * Upload multiple files to S3-compatible storage
   */
  async uploadFiles(
    files: Express.Multer.File[],
    type: UploadType = 'other',
    visibility?: ObjectVisibility,
  ): Promise<string[]> {
    if (!files?.length) throw new BadRequestException('No files provided');

    const uploadedUrls: string[] = [];
    for (const file of files) {
      const url = await this.uploadFile(file, type, visibility);
      uploadedUrls.push(url);
    }

    return uploadedUrls;
  }

  // --------------------------------------------------------------------------
  // FOLDED IN FROM THE `storage` MICROSERVICE
  //
  // Everything below was previously reached over TCP via `STORAGE_PATTERN.*`.
  // The bodies are unchanged from `apps/storage/src/providers/
  // upload-to-storage.provider.ts` apart from the field rename
  // (`this.bucket` -> `this.bucketName`), so the object keys written and the
  // URLs handed back are byte-identical to what the microservice produced.
  // --------------------------------------------------------------------------

  /**
   * Upload a file from a raw buffer under a caller-supplied key.
   *
   * Unlike `uploadFile`, the caller owns the key — the books module builds
   * `books/<ts>-<name>.pdf` and `/books/snapshots/<ts>-<name>` itself and
   * relies on those exact prefixes when it later deletes or archives the
   * objects, so no name generation happens here.
   *
   * @param visibility which bucket the object lands in, and therefore whether it
   *   may be fetched from storage without credentials. Omit it and the content
   *   type decides — images public, everything else private (see
   *   `defaultVisibilityFor`). Book deliverables pass `'private'` explicitly;
   *   covers and snapshots pass `'public'`.
   */
  async uploadFileFromBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
    visibility: ObjectVisibility = defaultVisibilityFor(contentType),
  ): Promise<string> {
    const bucket = this.bucketFor(visibility);

    const params: PutObjectCommandInput = {
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: ACL_BY_VISIBILITY[visibility],
    };

    try {
      await this.s3.send(new PutObjectCommand(params));

      // Deliberately the same builder `uploadFile` uses. These two writers used
      // to disagree in production — this one always emitted a path-style URL
      // while `uploadFile` emitted a virtual-host one — which meant the same
      // deployment stored two URL shapes and only one of them round-tripped
      // through the resolver below.
      return this.buildObjectUrl(bucket, key);
    } catch (err) {
      this.logS3Error(err, key);
      throw err;
    }
  }

  /**
   * Turn a stored object URL back into the bucket **and** key that address it.
   *
   * URLs are written by `uploadFile` / `uploadFileFromBuffer` in two shapes
   * depending on environment — path style (`<endpoint>/<bucket>/<key>`, what
   * MinIO gets locally) and virtual-host style (`https://<bucket>.<host>/<key>`,
   * what Spaces/S3 gets in production) — so callers that only hold the URL
   * cannot slice the key off by hand without getting one of the two wrong.
   *
   * The bucket half is what makes stored URLs survive the single-bucket → split-
   * bucket move: a row written before the split still names the old bucket, and
   * a read honours the name in the URL rather than assuming "private visibility
   * ⇒ private bucket". Nothing needs re-uploading for its download to work.
   *
   * Returns null rather than throwing for anything unparseable, so a single bad
   * row cannot take down a listing.
   */
  resolveObjectLocationFromUrl(url?: string | null): { bucket: string; key: string } | null {
    if (!url || typeof url !== 'string') return null;

    try {
      // Drop any query string (signed URLs, CDN tokens) before parsing.
      const parsed = new URL(url.split('?')[0]);

      const path = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
      if (!path) return null;

      // Path style: the bucket is the first path segment, and the key is
      // everything after it.
      for (const bucket of this.buckets) {
        if (path.startsWith(`${bucket}/`)) {
          const key = path.slice(bucket.length + 1);
          return key ? { bucket, key } : null;
        }
      }

      // Virtual-host style: the bucket is the leading hostname label, so the
      // whole path is already the key.
      const hostLabel = parsed.hostname.split('.')[0];
      if (this.buckets.includes(hostLabel)) {
        return { bucket: hostLabel, key: path };
      }

      // Neither shape matched — a URL from a bucket we no longer know about (a
      // renamed STORAGE_BUCKET), or an external host. Treat the whole path as
      // the key and leave the bucket unresolved; `getFile` probes both buckets
      // in that case, and a wrong guess simply 404s.
      return { bucket: '', key: path };
    } catch {
      return null;
    }
  }

  /**
   * Key-only view of {@link resolveObjectLocationFromUrl}, kept because most
   * callers only ever needed the key.
   */
  resolveObjectKeyFromUrl(url?: string | null): string | null {
    return this.resolveObjectLocationFromUrl(url)?.key ?? null;
  }

  /**
   * Retrieve a file stream from storage.
   *
   * @param key - Object key.
   * @param bucket - Which bucket holds it. Omit it and the private bucket is
   *   tried first (that is where every credentials-only read belongs), then the
   *   public one. The fallback exists for rows written before the bucket split,
   *   whose deliverables still sit in the old shared bucket; it costs one extra
   *   round trip only on a miss, and both attempts are authorised reads either
   *   way, so it grants no access the caller did not already have.
   */
  async getFile(key: string, bucket?: string): Promise<Readable> {
    if (!key) throw new BadRequestException('File key is required');

    const candidates = bucket ? [bucket] : [this.privateBucket, this.publicBucket].filter(Boolean);

    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const result = await this.s3.send(new GetObjectCommand({ Bucket: candidate, Key: key }));

        if (!result.Body) throw new BadRequestException('File not found');

        if (candidate !== candidates[0]) {
          this.logger.warn(
            `Object "${key}" was not in "${candidates[0]}" but was found in "${candidate}" — ` +
              'this row predates the public/private bucket split.',
          );
        }

        return result.Body as Readable;
      } catch (err) {
        lastError = err;
      }
    }

    this.logS3Error(lastError, key);
    throw new BadRequestException(`Failed to retrieve file: ${key}`);
  }

  /**
   * Work out which bucket holds an object, given a key that may or may not be
   * bucket-qualified.
   *
   * Callers hand us keys derived from stored URLs, and the two helpers that do
   * that (`books.service.ts`'s `extractStorageKeyFromUrl`, `delete-book.provider
   * .ts`'s `extractStorageKey`) both leave the bucket on the front for path-style
   * URLs — `the-magic-pages/books/1712-x.pdf`. That prefix used to be silently
   * wrong (it addressed a key that did not exist, so deletes no-op'd); now it is
   * the fastest possible answer to "which bucket?", so it is honoured rather
   * than fought.
   *
   * An unqualified key is probed with `HeadObject` — private bucket first, since
   * that is where deliverables and archives live.
   *
   * @returns the resolved location, or null when the object is in neither bucket.
   */
  private async locateObject(rawKey: string): Promise<{ bucket: string; key: string } | null> {
    const normalised = rawKey.replace(/^\/+/, '');

    for (const bucket of this.buckets) {
      if (normalised.startsWith(`${bucket}/`)) {
        const key = normalised.slice(bucket.length + 1);
        if (key) return { bucket, key };
      }
    }

    for (const bucket of [this.privateBucket, this.publicBucket].filter(Boolean)) {
      try {
        await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: normalised }));
        return { bucket, key: normalised };
      } catch {
        // Not in this bucket — try the next one.
      }
    }

    return null;
  }

  /**
   * Permanently delete multiple files from storage.
   *
   * Deletes each object individually so a partial failure is visible per key
   * rather than collapsing the whole batch, and returns both lists so the
   * caller can decide what to do about the failures.
   *
   * Each key is located first, because a key alone no longer says which bucket
   * it lives in. An object that is in neither bucket is reported as failed
   * rather than silently counted as deleted: `DeleteObject` succeeds on a
   * missing key, so without the lookup a typo'd key looks exactly like a
   * successful delete.
   */
  async deleteFiles(data: DeleteFilesRequest): Promise<DeleteFilesResponse> {
    const deleted: string[] = [];
    const failed: string[] = [];

    if (!data?.keys?.length) throw new BadRequestException('No file keys provided for deletion.');

    for (const rawKey of data.keys) {
      try {
        const location = await this.locateObject(rawKey);

        if (!location) {
          this.logger.warn(`Nothing to delete: "${rawKey}" is in neither storage bucket.`);
          failed.push(rawKey);
          continue;
        }

        await this.s3.send(new DeleteObjectCommand({ Bucket: location.bucket, Key: location.key }));
        deleted.push(rawKey);
      } catch (err) {
        failed.push(rawKey);
        this.logS3Error(err, rawKey);
      }
    }

    this.logger.log(`🗑️ Deleted ${deleted.length} files, ${failed.length} failed.`);
    return { deleted, failed };
  }

  /**
   * Move files to another prefix (e.g. `archive/`).
   *
   * Copy-then-delete per object, and the delete only runs if the copy
   * succeeded — a failed move leaves the original in place rather than losing
   * the file.
   *
   * The copy always lands in the **private** bucket, whatever bucket the source
   * was in, and is written with the `private` ACL on top of that. The only
   * caller is the archive path in `DeleteBookProvider` — by the time a key gets
   * moved under `archive/`, the book row is soft-deleted and nothing serves
   * those URLs, so there is no reason for the archived copy to be world-readable.
   * Archiving a cover therefore *demotes* it out of the public bucket, which is
   * the desired direction; the old behaviour forced `public-read` and left a
   * permanently public copy of every archived deliverable behind.
   *
   * DigitalOcean Spaces supports `CopyObject` across buckets in the same region
   * (cross-region and cross-cluster copies are not supported), and both buckets
   * come from the same endpoint and region here, so the cross-bucket copy is
   * safe on the production target as well as on MinIO.
   */
  async handleMoveFiles(data: MoveFilesRequest): Promise<MoveFilesResponse> {
    if (!data?.keys?.length) throw new BadRequestException('No file keys provided for moving.');

    const moved: string[] = [];
    const failed: string[] = [];

    for (const rawKey of data.keys) {
      try {
        const source = await this.locateObject(rawKey);

        if (!source) {
          this.logger.warn(`Nothing to archive: "${rawKey}" is in neither storage bucket.`);
          failed.push(rawKey);
          continue;
        }

        const destinationKey = `${data.destinationPrefix}${source.key}`;

        await this.s3.send(
          new CopyObjectCommand({
            Bucket: this.privateBucket,
            CopySource: `${source.bucket}/${source.key}`,
            Key: destinationKey,
            ACL: ACL_BY_VISIBILITY.private,
          }),
        );

        // Delete only after a successful copy
        await this.s3.send(new DeleteObjectCommand({ Bucket: source.bucket, Key: source.key }));

        moved.push(destinationKey);
        this.logger.log(`📦 Moved ${source.bucket}/${source.key} → ${this.privateBucket}/${destinationKey}`);
      } catch (err) {
        failed.push(rawKey);
        this.logS3Error(err, rawKey);
      }
    }

    this.logger.log(`Move operation complete. ${moved.length} moved, ${failed.length} failed.`);
    return { moved, failed };
  }

  /**
   * Generate clean file name with type and timestamp
   */
  private generateFileName(file: Express.Multer.File, type: UploadType): string {
    const baseName = path.parse(file.originalname).name.replace(/\s+/g, '_');
    const ext = path.extname(file.originalname);
    const timestamp = Date.now();
    return `${type}/${baseName}_${timestamp}_${uuidv4()}${ext}`;
  }

  /**
   * Validate file type based on allowed MIME types
   */
  private validateFileType(file: Express.Multer.File, type: UploadType): void {
    const mime = file.mimetype;

    const allowedTypes: Record<UploadType, string[]> = {
      photo: ['image/jpeg', 'image/png', 'image/webp'],
      pdf: ['application/pdf'],
      xls: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      other: [],
    };

    if (allowedTypes[type].length && !allowedTypes[type].includes(mime)) {
      throw new BadRequestException(`Invalid file type for ${type}: ${mime}`);
    }
  }

  /**
   * Log detailed S3 upload errors
   */
  private logS3Error(err: any, fileName: string) {
    this.logger.error(`❌ Upload failed for: ${fileName}`);
    if (err.$metadata) {
      this.logger.error(`Status: ${err.$metadata.httpStatusCode}`);
      this.logger.error(`Request ID: ${err.$metadata.requestId}`);
    }
    if (err.Code) {
      this.logger.error(`Code: ${err.Code}`);
      this.logger.error(`Message: ${err.message}`);
    }
  }
}
