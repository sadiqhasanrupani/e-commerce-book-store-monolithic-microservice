import { ConfigService } from '@nestjs/config';

import { UploadToStorageProvider } from './upload-to-storage.provider';

/**
 * Captures what the provider actually asks S3/MinIO to do. Jest hoists
 * `jest.mock` above the imports, so the shared spy has to be `mock`-prefixed to
 * be allowed inside the factory.
 */
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  class FakeCommand {
    constructor(public readonly input: any) {}
  }

  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: class PutObjectCommand extends FakeCommand {},
    CopyObjectCommand: class CopyObjectCommand extends FakeCommand {},
    DeleteObjectCommand: class DeleteObjectCommand extends FakeCommand {},
    GetObjectCommand: class GetObjectCommand extends FakeCommand {},
    HeadObjectCommand: class HeadObjectCommand extends FakeCommand {},
    HeadBucketCommand: class HeadBucketCommand extends FakeCommand {},
    CreateBucketCommand: class CreateBucketCommand extends FakeCommand {},
    PutBucketPolicyCommand: class PutBucketPolicyCommand extends FakeCommand {},
    GetBucketPolicyCommand: class GetBucketPolicyCommand extends FakeCommand {},
  };
});

const PUBLIC_BUCKET = 'the-magic-pages';
const PRIVATE_BUCKET = 'the-magic-pages-private';

const CONFIG: Record<string, string> = {
  's3.storageEndpoint': 'http://minio:9000',
  's3.storagePort': '9000',
  's3.storageBucket': PUBLIC_BUCKET,
  's3.storagePrivateBucket': PRIVATE_BUCKET,
  's3.storageRegion': 'us-east-1',
  's3.storageAccessKey': 'access-key',
  's3.storageSecretKey': 'secret-key',
  NODE_ENV: 'test',
};

/** Every command class in the mock records what it was constructed with. */
interface CapturedCommand {
  input: Record<string, unknown>;
}

const buildFile = (mimetype: string, originalname = 'asset'): Express.Multer.File =>
  ({
    originalname,
    mimetype,
    size: 1024,
    buffer: Buffer.from('bytes'),
  }) as unknown as Express.Multer.File;

const buildProvider = (overrides: Record<string, string | undefined> = {}) => {
  const config = { ...CONFIG, ...overrides };

  const configService = {
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  // Note: `onModuleInit` (bucket creation / policy) is only called by the tests
  // that assert on it.
  return new UploadToStorageProvider(configService);
};

/**
 * Where an object lands is a security boundary here, not a storage detail.
 *
 * Every write used to go to one bucket with a `public-read` ACL, which meant a
 * paid ebook got a permanent, credential-free URL the moment it was uploaded —
 * the download endpoint's ownership and payment checks were bypassable by anyone
 * who saw the link. The first fix set per-object ACLs; this suite now pins the
 * stronger property that replaced them: catalogue imagery goes to a bucket that
 * is anonymously readable, and everything else goes to a bucket that is not,
 * so a forgotten visibility cannot leak a deliverable even in principle.
 */
describe('UploadToStorageProvider bucket routing', () => {
  let provider: UploadToStorageProvider;

  const commands = (name: string): CapturedCommand[] =>
    mockSend.mock.calls
      .map(([command]) => command as CapturedCommand)
      .filter((command) => command.constructor.name === name);

  const lastPut = () => {
    const puts = commands('PutObjectCommand');
    return puts[puts.length - 1];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});

    provider = buildProvider();
  });

  describe('uploadFileFromBuffer — the books module path', () => {
    it('stores a book deliverable in the private bucket when the caller says so', async () => {
      const url = await provider.uploadFileFromBuffer(
        'books/1712-paid.pdf',
        Buffer.from('pdf'),
        'application/pdf',
        'private',
      );

      expect(lastPut().input.Bucket).toBe(PRIVATE_BUCKET);
      expect(lastPut().input.ACL).toBe('private');
      expect(url).toBe(`http://minio:9000/${PRIVATE_BUCKET}/books/1712-paid.pdf`);
    });

    it('stores cover art and snapshots in the public bucket so the storefront can render them', async () => {
      const url = await provider.uploadFileFromBuffer(
        '/books/snapshots/1712-cover.png',
        Buffer.from('png'),
        'image/png',
        'public',
      );

      expect(lastPut().input.Bucket).toBe(PUBLIC_BUCKET);
      expect(lastPut().input.ACL).toBe('public-read');
      expect(url).toBe(`http://minio:9000/${PUBLIC_BUCKET}//books/snapshots/1712-cover.png`);
    });

    /**
     * Fail-closed default. The legacy fallback branches in `books.service.ts`
     * and `create-book.provider.ts` push variant files through the snapshot
     * helper without stating a visibility; deriving it from the content type is
     * what stops those paths leaking a deliverable.
     */
    it('defaults a non-image to the private bucket when no visibility is given', async () => {
      await provider.uploadFileFromBuffer('books/1712-fallback.epub', Buffer.from('epub'), 'application/epub+zip');

      expect(lastPut().input.Bucket).toBe(PRIVATE_BUCKET);
      expect(lastPut().input.ACL).toBe('private');
    });

    it('defaults an image to the public bucket when no visibility is given', async () => {
      await provider.uploadFileFromBuffer('/books/snapshots/1712-page.jpeg', Buffer.from('jpg'), 'image/jpeg');

      expect(lastPut().input.Bucket).toBe(PUBLIC_BUCKET);
      expect(lastPut().input.ACL).toBe('public-read');
    });
  });

  describe('uploadFile — the generic POST /admin/upload path', () => {
    it('keeps admin-uploaded imagery in the public bucket', async () => {
      await provider.uploadFile(buildFile('image/png', 'cover.png'), 'photo');

      expect(lastPut().input.Bucket).toBe(PUBLIC_BUCKET);
      expect(lastPut().input.ACL).toBe('public-read');
    });

    it('stores an admin-uploaded document in the private bucket', async () => {
      await provider.uploadFile(buildFile('application/pdf', 'ebook.pdf'), 'pdf');

      expect(lastPut().input.Bucket).toBe(PRIVATE_BUCKET);
      expect(lastPut().input.ACL).toBe('private');
    });

    it('honours an explicit visibility override', async () => {
      await provider.uploadFile(buildFile('image/png', 'internal.png'), 'photo', 'private');

      expect(lastPut().input.Bucket).toBe(PRIVATE_BUCKET);
      expect(lastPut().input.ACL).toBe('private');
    });
  });

  /**
   * A deployment that forgets `STORAGE_PRIVATE_BUCKET` must still keep
   * deliverables out of the public bucket — the fallback derives a private name
   * rather than reusing the public one.
   */
  describe('configuration fallback', () => {
    it('derives <STORAGE_BUCKET>-private when the private bucket is unset', async () => {
      const fallbackProvider = buildProvider({ 's3.storagePrivateBucket': undefined });

      await fallbackProvider.uploadFileFromBuffer('books/x.pdf', Buffer.from('pdf'), 'application/pdf', 'private');

      expect(lastPut().input.Bucket).toBe(`${PUBLIC_BUCKET}-private`);
      expect(lastPut().input.Bucket).not.toBe(PUBLIC_BUCKET);
    });
  });

  describe('onModuleInit — bucket provisioning', () => {
    it('creates both buckets and publishes only the public one', async () => {
      // Neither bucket exists yet, so both get created.
      mockSend.mockImplementation((command: CapturedCommand) =>
        command.constructor.name === 'HeadBucketCommand'
          ? Promise.reject(Object.assign(new Error('NotFound'), { name: 'NotFound' }))
          : Promise.resolve({}),
      );

      await provider.onModuleInit();

      const created = commands('CreateBucketCommand').map((command) => command.input.Bucket);
      expect(created).toEqual([PUBLIC_BUCKET, PRIVATE_BUCKET]);

      const policies = commands('PutBucketPolicyCommand');
      expect(policies).toHaveLength(1);
      expect(policies[0].input.Bucket).toBe(PUBLIC_BUCKET);
      expect(JSON.parse(policies[0].input.Policy as string)).toMatchObject({
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${PUBLIC_BUCKET}/*`],
          },
        ],
      });
    });

    it('does not fail boot when the storage provider refuses PutBucketPolicy', async () => {
      // DigitalOcean Spaces rejects PutBucketPolicy on limited-access keys.
      mockSend.mockImplementation((command: CapturedCommand) => {
        if (command.constructor.name === 'PutBucketPolicyCommand') {
          return Promise.reject(Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' }));
        }
        return Promise.resolve({});
      });

      await expect(provider.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('getFile — the authorised read path', () => {
    it('reads deliverables from the private bucket', async () => {
      mockSend.mockResolvedValue({ Body: 'stream' });

      await provider.getFile('books/1712-paid.pdf');

      const gets = commands('GetObjectCommand');
      expect(gets).toHaveLength(1);
      expect(gets[0].input.Bucket).toBe(PRIVATE_BUCKET);
    });

    /**
     * Rows written before the split still point at the old shared bucket. The
     * download endpoint must keep serving them rather than 404ing on data that
     * is perfectly intact.
     */
    it('falls back to the public bucket for objects written before the split', async () => {
      mockSend.mockImplementation((command: CapturedCommand) =>
        command.input.Bucket === PRIVATE_BUCKET
          ? Promise.reject(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }))
          : Promise.resolve({ Body: 'stream' }),
      );

      await expect(provider.getFile('books/legacy.pdf')).resolves.toBe('stream');

      const gets = commands('GetObjectCommand').map((command) => command.input.Bucket);
      expect(gets).toEqual([PRIVATE_BUCKET, PUBLIC_BUCKET]);
    });

    it('fails when the object is in neither bucket', async () => {
      mockSend.mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));

      await expect(provider.getFile('books/missing.pdf')).rejects.toThrow('Failed to retrieve file');
    });
  });

  describe('resolveObjectLocationFromUrl', () => {
    it('routes a path-style URL back to the bucket it names', () => {
      expect(provider.resolveObjectLocationFromUrl(`http://minio:9000/${PRIVATE_BUCKET}/books/a.pdf`)).toEqual({
        bucket: PRIVATE_BUCKET,
        key: 'books/a.pdf',
      });

      expect(provider.resolveObjectLocationFromUrl(`http://minio:9000/${PUBLIC_BUCKET}/photo/a.png`)).toEqual({
        bucket: PUBLIC_BUCKET,
        key: 'photo/a.png',
      });
    });

    it('routes a virtual-host style URL (Spaces) back to the bucket it names', () => {
      expect(
        provider.resolveObjectLocationFromUrl(`https://${PRIVATE_BUCKET}.blr1.digitaloceanspaces.com/books/a.pdf`),
      ).toEqual({ bucket: PRIVATE_BUCKET, key: 'books/a.pdf' });
    });

    it('keeps returning the bare key for callers that only want that', () => {
      expect(provider.resolveObjectKeyFromUrl(`http://minio:9000/${PRIVATE_BUCKET}/books/a.pdf`)).toBe('books/a.pdf');
      expect(provider.resolveObjectKeyFromUrl(null)).toBeNull();
      expect(provider.resolveObjectKeyFromUrl('not a url')).toBeNull();
    });
  });

  describe('deleteFiles', () => {
    it('deletes a bucket-qualified key from the bucket it names, without probing', async () => {
      const result = await provider.deleteFiles({ keys: [`${PUBLIC_BUCKET}/photo/cover.png`] });

      expect(commands('HeadObjectCommand')).toHaveLength(0);

      const deletes = commands('DeleteObjectCommand');
      expect(deletes).toHaveLength(1);
      expect(deletes[0].input).toMatchObject({ Bucket: PUBLIC_BUCKET, Key: 'photo/cover.png' });
      expect(result.deleted).toEqual([`${PUBLIC_BUCKET}/photo/cover.png`]);
    });

    it('probes for the bucket when the key is not qualified', async () => {
      mockSend.mockImplementation((command: CapturedCommand) =>
        command.constructor.name === 'HeadObjectCommand' && command.input.Bucket === PRIVATE_BUCKET
          ? Promise.reject(Object.assign(new Error('NotFound'), { name: 'NotFound' }))
          : Promise.resolve({}),
      );

      await provider.deleteFiles({ keys: ['photo/cover.png'] });

      const deletes = commands('DeleteObjectCommand');
      expect(deletes).toHaveLength(1);
      expect(deletes[0].input).toMatchObject({ Bucket: PUBLIC_BUCKET, Key: 'photo/cover.png' });
    });

    it('reports a key that is in neither bucket as failed rather than deleted', async () => {
      mockSend.mockImplementation((command: CapturedCommand) =>
        command.constructor.name === 'HeadObjectCommand'
          ? Promise.reject(Object.assign(new Error('NotFound'), { name: 'NotFound' }))
          : Promise.resolve({}),
      );

      const result = await provider.deleteFiles({ keys: ['books/ghost.pdf'] });

      expect(result).toEqual({ deleted: [], failed: ['books/ghost.pdf'] });
      expect(commands('DeleteObjectCommand')).toHaveLength(0);
    });
  });

  describe('handleMoveFiles — the archive path', () => {
    it('archives into the private bucket rather than re-publishing the object', async () => {
      const result = await provider.handleMoveFiles({
        keys: [`${PUBLIC_BUCKET}/books/1712-cover.png`],
        destinationPrefix: 'archive/',
      });

      expect(result.moved).toEqual(['archive/books/1712-cover.png']);

      const copy = commands('CopyObjectCommand')[0];
      expect(copy.input).toMatchObject({
        Bucket: PRIVATE_BUCKET,
        CopySource: `${PUBLIC_BUCKET}/books/1712-cover.png`,
        Key: 'archive/books/1712-cover.png',
        ACL: 'private',
      });

      // The source is removed from the bucket it was actually in.
      expect(commands('DeleteObjectCommand')[0].input).toMatchObject({
        Bucket: PUBLIC_BUCKET,
        Key: 'books/1712-cover.png',
      });
    });

    it('keeps an already-private deliverable in the private bucket', async () => {
      const result = await provider.handleMoveFiles({
        keys: [`${PRIVATE_BUCKET}/books/1712-paid.pdf`],
        destinationPrefix: 'archive/',
      });

      expect(result.moved).toEqual(['archive/books/1712-paid.pdf']);

      const copy = commands('CopyObjectCommand')[0];
      expect(copy.input).toMatchObject({
        Bucket: PRIVATE_BUCKET,
        CopySource: `${PRIVATE_BUCKET}/books/1712-paid.pdf`,
        ACL: 'private',
      });
    });

    it('does not delete the source when the copy fails', async () => {
      mockSend.mockImplementation((command: CapturedCommand) =>
        command.constructor.name === 'CopyObjectCommand'
          ? Promise.reject(new Error('copy exploded'))
          : Promise.resolve({}),
      );

      const result = await provider.handleMoveFiles({
        keys: [`${PRIVATE_BUCKET}/books/1712-paid.pdf`],
        destinationPrefix: 'archive/',
      });

      expect(result.failed).toEqual([`${PRIVATE_BUCKET}/books/1712-paid.pdf`]);
      expect(commands('DeleteObjectCommand')).toHaveLength(0);
    });
  });
});
