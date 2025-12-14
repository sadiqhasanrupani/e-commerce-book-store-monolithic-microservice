import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';
import { UserContext } from '../../auth/providers/user-context.service';
import { BookResponseDto } from '@app/contract/books/dtos/book-response.dto';
import { BookVariantResponseDto } from '@app/contract/books/dtos/book-variant-response.dto';

import { CreateBookProvider } from './create-book.provider';
import { UploadBookFilesProvider } from './upload-book-files.provider';

import { CreateBookData } from '@app/contract/books/types/book.type';
import { DataSource, QueryRunner, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

import { Book } from '@app/contract/books/entities/book.entity';
import { AgeGroup } from '@app/contract/age-groups/entities/age-group.entity';
import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { In } from 'typeorm';
import { DeleteBookProvider } from './delete-book.provider';
import { DeleteOption } from '@app/contract/books/types/delete-book.type';
import {
  FindAllBookQueryParam,
  FindAllBookResponse,
  FindOneBookOption,
} from '@app/contract/books/types/find-book.type';
import { FindBookProvider } from './find-book.provider';
import { BufferType } from '@app/contract/books/types/upload-book-file.type';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Category } from '@app/contract/books/entities/categories.entity';
import { Tag } from '@app/contract/books/entities/tags.entity';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';

type UploadAssetsResult = {
  uploadedKeys: string[];
  coverImageUrl: string | undefined;
  snapshotUrls: string[];
  variantFileUrls: Array<string | undefined>;
};

/**
 * Service responsible for handling all book-related operations,
 * including bulk creation with full transactional safety.
 */
@Injectable()
export class BooksService {
  private readonly logger = new Logger(BooksService.name);
  /**
   * Injecting the Book repository to interact with the database.
   */
  constructor(
    /**
     * Injecting uploadBookFilesProvider
     * */
    private readonly uploadBookFilesProvider: UploadBookFilesProvider,

    /**
     * Inject deleteBookProvider
     * */
    private readonly deleteBookProvider: DeleteBookProvider,

    /**
     * Inject userRepository
     * */
    @InjectRepository(Book)
    private readonly bookRepository: Repository<Book>,

    /**
     * Inject dataSource
     * */
    private readonly dataSource: DataSource,

    /**
     * Inject findBookProvider
     * */
    private readonly findBookProvider: FindBookProvider,

    /** Inject createBookProvider */
    private readonly createBookProvider: CreateBookProvider,
  ) { } //eslint-disable-line

  /**
   * Extracts the object storage key (path inside the bucket) from a full URL.
   *
   * Handles:
   *  - MinIO  (http://localhost:9000/bucket/path/file.pdf)
   *  - S3     (https://bucket.s3.amazonaws.com/path/file.pdf)
   *  - Spaces (https://bucket.region.digitaloceanspaces.com/path/file.pdf)
   *  - CDN URLs (https://cdn.example.com/path/file.pdf)
   *  - Signed URLs (?X-Amz-Signature=...)
   *
   * Output ALWAYS looks like:
   *    "bucket/path/file.pdf"
   * or if bucket isn't part of the URL:
   *    "path/file.pdf"
   *
   * @param url - raw URL stored in DB
   * @returns string | null - sanitized storage key
   */
  protected extractStorageKeyFromUrl(url?: string | null): string | null {
    if (!url || typeof url !== 'string') return null;

    try {
      // Strip query params (signed URLs, CDN tokens, etc.)
      const cleanUrl = url.split('?')[0];

      const u = new URL(cleanUrl);

      // Normalize path
      let key = u.pathname.replace(/^\/+/, ''); // remove leading "/"
      key = key.replace(/\/+$/, ''); // remove trailing "/"

      if (!key) return null;

      /**
       * Case 1: Standard S3 virtual-host style:
       *   https://bucket.s3.amazonaws.com/path/file.pdf
       * Host looks like: "<bucket>.s3.amazonaws.com"
       *
       * We must ensure we do not accidentally prepend bucket twice.
       */
      const hostParts = u.hostname.split('.');
      const bucketCandidate = hostParts[0] ?? null;

      const isAwsStyle =
        u.hostname.includes('amazonaws.com') ||
        u.hostname.includes('digitaloceanspaces.com') ||
        u.hostname.includes('s3.') ||
        u.hostname.includes('r2.cloudflarestorage.com');

      if (isAwsStyle) {
        // If bucket is already included in key, return as-is.
        if (bucketCandidate && key.startsWith(bucketCandidate + '/')) {
          return key;
        }

        // Otherwise, prepend it:
        if (bucketCandidate) {
          return `${bucketCandidate}/${key}`;
        }
      }

      /**
       * Case 2: MinIO with path-style bucket URLs:
       *   http://localhost:9000/the-magic-pages/books/file.pdf
       * Path looks like: "/the-magic-pages/books/file.pdf"
       *
       * The path already contains the bucket, so we return it as-is.
       */
      return key;
    } catch (err) {
      /**
       * Fallback logic if URL parsing fails:
       *  - Strip protocol if present
       *  - Drop hostname
       *  - Return remaining path
       */
      try {
        const noProto = url.replace(/^https?:\/\//, '');
        const parts = noProto.split('/');
        if (parts.length <= 1) return null;
        return parts.slice(1).join('/');
      } catch {
        return null;
      }
    }
  }

  private async validateCreateInput(dto: CreateBookDto): Promise<void> {
    const required = ['title', 'authorName', 'publishedDate', 'price', 'rating'];

    for (const field of required) {
      if (!dto[field]) {
        throw new BadRequestException(`Missing required field: "${field}".`);
      }
    }
  }

  private async ensureTitleIsUnique(title: string): Promise<void> {
    const existing = await this.findBookProvider.findByTitle(title);

    if (existing) {
      throw new ConflictException(`A book with the title "${title}" already exists.`);
    }
  }

  private async uploadAssets(files: any, createBookDto: CreateBookDto): Promise<UploadAssetsResult> {
    const uploadedKeys: string[] = []; // for cleanup in case of failure.
    let coverImageUrl: string | undefined;
    let snapshotUrls: string[] = [];
    const variantFileUrls: Array<string | undefined> = new Array(createBookDto.variants.length).fill(undefined);

    try {
      /** 2.a upload coverImage */
      if (files?.bookCover) {
        const payload: BufferType[] = [
          {
            buffer: files.bookCover.buffer,
            filename: files.bookCover.filename,
            mimetype: files.bookCover.mimetype,
          },
        ];
        const [url] = await this.uploadBookFilesProvider.uploadBuffers(payload);
        coverImageUrl = url;
        const k = this.extractStorageKeyFromUrl(url);
        if (k) uploadedKeys.push(k);
      }

      /** 2.b upload snapshots (if any) */
      if (files?.snapshots) {
        const payload: BufferType[] = files.snapshots.map((file) => ({
          buffer: file.buffer,
          filename: file.filename,
          mimetype: file.mimetype,
        }));

        const urls = await this.uploadBookFilesProvider.uploadBuffers(payload);
        snapshotUrls = urls;

        // get the keys and push it to uploadedKeys
        for (const u of urls) {
          const k = this.extractStorageKeyFromUrl(u);
          if (k) uploadedKeys.push(k);
        }
      }

      /** 2.c upload variant files in order (if provided)
       * Mapping rule: variantFiles[i] -> createBookDto.variants[i]
       * */
      if (files?.variantFiles?.length) {
        // prefer provider.uploadPdfs for document uploads if available (batch)
        // fall back to uploadBuffers if provider doesn't have uploadPdfs
        const variantFiles = files.variantFiles;
        // try batch using uploadPdfs (assumes provider returns urls in same order)
        if (typeof this.uploadBookFilesProvider.uploadPdfs === 'function') {
          const urls = await this.uploadBookFilesProvider.uploadPdfs(variantFiles);
          for (let i = 0; i < Math.min(urls.length, variantFileUrls.length); i++) {
            variantFileUrls[i] = urls[i];
            const k = this.extractStorageKeyFromUrl(urls[i]);
            if (k) uploadedKeys.push(k);
          }
        } else {
          // fallback: upload individually by buffer
          for (let i = 0; i < Math.min(variantFiles.length, variantFileUrls.length); i++) {
            const f = variantFiles[i];
            const [url] = await this.uploadBookFilesProvider.uploadBuffers([
              {
                buffer: f.buffer,
                filename: f.originalname,
                mimetype: f.mimetype,
              },
            ]);
            variantFileUrls[i] = url;
            const k = this.extractStorageKeyFromUrl(url);
            if (k) uploadedKeys.push(k);
          }
        }
      }

      // NOTE: Any variant that doesn't receive a variantFileUrl remains undefined — may be allowed (e.g. physical format)
    } catch (uploadErr) {
      // Upload failed — nothing persisted; attempt cleanup for partially uploaded keys (best-effort)
      this.logger.error('Asset upload failed while creating book', uploadErr);
      if (uploadedKeys.length > 0 && typeof this.uploadBookFilesProvider.deleteObjects === 'function') {
        try {
          await this.uploadBookFilesProvider.deleteObjects(uploadedKeys);
        } catch (cleanupErr) {
          this.logger.error('Failed to cleanup uploaded assets after upload error', cleanupErr);
        }
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to upload assets',
          error: (uploadErr as Error).message ?? String(uploadErr),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return { uploadedKeys, variantFileUrls, coverImageUrl, snapshotUrls };
  }

  /**
   * Create a new book entry in the database.
   * Uploads the book image via Storage microservice if provided.
   *
   * @param data - Data contains validated CreateBookDto (variants: CreateBookVariantDto[])
   * and optional file containers.
   *  {
   *    data: CreateBookDto,
   *    files: {
   *      bookCover?: Express.Multer.File,
   *      snapshots?: Express.Multer.File[],
   *      variantFiles?: Express.Multer.File[]
   *    }
   *  }
   */
  async create(data: CreateBookData): Promise<Book> {
    const { createBookDto, files } = data;

    // 0. quick guards
    if (!createBookDto) {
      throw new BadRequestException('createBookDto is required');
    }

    if (!Array.isArray(createBookDto.variants) || createBookDto.variants.length === 0) {
      throw new BadRequestException('At least one variant is required');
    }

    /** 1. fail-fast domain invairant check (no heavy I/O) */
    await this.ensureTitleIsUnique(createBookDto.title);

    /** 2. upload assests (only after invariants passed)
     * We gather uploaded URLs to attach to DTO before DB transaction
     * */
    const { coverImageUrl, snapshotUrls, uploadedKeys, variantFileUrls } = await this.uploadAssets(
      files,
      createBookDto,
    );

    // --- 3. persist Book + Variants inside a single transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 3.a prepare Book entity payload (normalize DTO -> entity fields)
      const bookPayload: Partial<Book> = {
        title: createBookDto.title,
        subtitle: createBookDto.subtitle,
        description: createBookDto.description,
        shortDescription: createBookDto.shortDescription,
        bullets: createBookDto.bullets,
        genre: createBookDto.genre,
        authorId: createBookDto.authorId ?? undefined,
        authorName: createBookDto.authorName ?? createBookDto.author?.name ?? undefined,
        coverImageUrl: coverImageUrl ?? createBookDto.coverImageUrl ?? undefined,
        snapshotUrls: snapshotUrls.length ? snapshotUrls : createBookDto.snapshotUrls,
        snapshots: snapshotUrls.length ? snapshotUrls : createBookDto.snapshots,
        slug: createBookDto.slug,
        metaTitle: createBookDto.metaTitle,
        metaDescription: createBookDto.metaDescription,
        isBestseller: createBookDto.isBestseller ?? false,
        isFeatured: createBookDto.isFeatured ?? false,
        isNewRelease: createBookDto.isNewRelease ?? false,
        allowReviews: createBookDto.allowReviews ?? true,
        allowWishlist: createBookDto.allowWishlist ?? true,
        visibility: createBookDto.visibility ?? 'public',
        // leave isArchived/archivedAt/deletedAt to defaults
      };

      // Handle Age Groups
      if (createBookDto.ageGroupIds && createBookDto.ageGroupIds.length > 0) {
        const ageGroups = await queryRunner.manager.getRepository(AgeGroup).findBy({
          id: In(createBookDto.ageGroupIds),
        });
        bookPayload.ageGroups = ageGroups;
      }

      // Handle Categories
      if (createBookDto.categoryIds && createBookDto.categoryIds.length > 0) {
        const categories = await queryRunner.manager.getRepository(Category).findBy({
          id: In(createBookDto.categoryIds),
        });
        bookPayload.categories = categories;
      }

      // Handle Tags
      if (createBookDto.tagIds && createBookDto.tagIds.length > 0) {
        const tags = await queryRunner.manager.getRepository(Tag).findBy({
          id: In(createBookDto.tagIds),
        });
        bookPayload.tags = tags;
      }

      // create Book row
      const bookRepo = queryRunner.manager.getRepository(Book);
      const bookEntity = bookRepo.create(bookPayload);
      const savedBook = await bookRepo.save(bookEntity);

      // 3.b create variants — map DTO.variants -> BookFormatVariant rows
      const variantsToSave = createBookDto.variants.map((vDto, idx) => {
        const variant: Partial<BookFormatVariant> = {
          // because BookFormatVariant.id is number PK and bookId is number in your current model,
          // but you told me to keep variant IDs as number — however book id is UUID so we must set book relation properly.
          // Note: TypeORM will set book relation via book property or book_id column; we set book (relation) here.
          book: savedBook,
          format: vDto.format as any,
          // priceCents on variant DTO is 'priceCents' — use appropriate column names (price in your entity is numeric; we used priceCents on DTO)
          // Convert integer cents to numeric stored value as string/number depending on DB mapping. Here we store as numeric/decimal:
          price: typeof (vDto as any).priceCents !== 'undefined' ? (vDto as any).priceCents / 100 : undefined,
          stockQuantity: isPhysicalFormat(vDto.format as any) ? (vDto.stockQuantity ?? 0) : 0,
          reservedQuantity: 0,
          fileUrl: variantFileUrls[idx] ?? vDto.fileUrl ?? null,
          isbn: vDto.isbn,

          // NOTE: These are FUTURE features, currently they don't need any kind of attention
          // previewPageCount: vDto.previewPageCount ?? 0,
          // previewFileUrl: vDto.previewFileUrl ?? null,
          // weightG: vDto.weightG ?? null,
        };
        return queryRunner.manager.create(BookFormatVariant as any, variant);
      });

      // Save all variants (in loop to allow DB adapter to assign numeric PKs correctly)
      for (const variantEntity of variantsToSave) {
        await queryRunner.manager.save(BookFormatVariant as any, variantEntity);
      }

      // 3.c commit
      await queryRunner.commitTransaction();

      // reload book with variants to return (fresh)
      const bookWithRelations = await this.bookRepository.findOne({
        where: { id: savedBook.id },
        relations: ['formats', 'categories', 'tags', 'metrics', 'author', 'ageGroups'],
      });

      this.logger.log(`Book created: ${savedBook.id} (variants: ${createBookDto.variants.length})`);
      return bookWithRelations!;
    } catch (dbErr) {
      // rollback + best-effort storage cleanup (uploadedKeys)
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to persist book + variants; rolled back transaction', dbErr);

      if (uploadedKeys.length > 0 && typeof this.uploadBookFilesProvider.deleteObjects === 'function') {
        try {
          await this.uploadBookFilesProvider.deleteObjects(uploadedKeys);
        } catch (cleanupErr) {
          this.logger.error('Failed storage cleanup after DB rollback', cleanupErr);
        }
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create book',
          error: (dbErr as Error).message ?? String(dbErr),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await queryRunner.release();
    }
    // Persist book with strong transactional guarantees
    // return this.createBookProvider.createBook(bookRepo);
  }

  /**
   * Creates multiple book records in a single transaction.
   *
   * Each book in the input list may optionally include uploaded files:
   * - `bookCover`: main cover image (JPEG, PNG)
   * - `snapshots`: list of image files (for previews)
   * - `file`: eBook or document (PDF, DOCX, etc.)
   *
   * This method:
   * 1. Uploads all files in parallel for each book.
   * 2. Creates database entries within a single transaction.
   * 3. Rolls back the entire operation if any upload or save fails.
   *
   * @param booksData - Array of book creation payloads containing DTOs and optional file objects.
   * @returns An array of successfully created {@link Book} entities.
   * @throws {HttpException} If any upload or database operation fails.
   *
   * @example
   * ```ts
   * await booksService.bulkCreate([
   *   { createBookDto: dto1, files: { bookCover: [...], file: [...] } },
   *   { createBookDto: dto2, files: { snapshots: [...] } }
   * ]);
   * ```
   */
  async bulkCreate(
    inputs: Array<{
      createBookDto: CreateBookDto;
      files?: {
        bookCover?: Express.Multer.File;
        snapshots?: Express.Multer.File[];
        variantFiles?: Express.Multer.File[];
      };
    }>,
    options?: { concurrency?: number },
  ): Promise<Book[]> {
    try {
      return await this.createBookProvider.bulkCreate(inputs, options);
    } catch (error) {
      let message = 'Failed to create books';
      if (error instanceof Error) {
        message = error.message;
      }

      this.logger.error(` Bulk create failed: ${message}`);

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message,
          error: 'Bulk book creation failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll(
    queryParams?: FindAllBookQueryParam,
    options?: { isAdmin?: boolean; userContext?: UserContext },
  ): Promise<FindAllBookResponse> {
    const result = await this.findBookProvider.findAll(queryParams, options);

    const transformedData = result.data.map((book) =>
      this.transformBookToResponse(book, options?.userContext),
    );

    return {
      message: 'Books retrieved successfully',
      ...result,
      data: transformedData,
    };
  }

  /**
   * Retrieve a single book by its ID.
   */
  async findOne(
    id: string,
    opts?: FindOneBookOption & { isAdmin?: boolean; userContext?: UserContext },
  ): Promise<BookResponseDto> {
    const book = await this.findBookProvider.findOne(id, opts);
    return this.transformBookToResponse(book, opts?.userContext);
  }

  /**
   * Find related books based on genre.
   */
  async findRelated(
    id: string,
    options?: { userContext?: UserContext },
  ): Promise<BookResponseDto[]> {
    // 1. Get the current book to find its genre
    const currentBook = await this.findBookProvider.findOne(id);

    if (!currentBook.genre) {
      return [];
    }

    // 2. Find other books with the same genre
    const result = await this.findBookProvider.findAll({
      genre: currentBook.genre as any, // Type cast if necessary, or ensure BookGenre import
      limit: 5, // Limit related books
    });

    // 3. Filter out the current book and transform
    return result.data
      .filter((book) => book.id !== id)
      .map((book) => this.transformBookToResponse(book, options?.userContext));
  }

  private transformBookToResponse(book: Book, context?: UserContext): BookResponseDto {
    const currency = context?.currency || 'INR';
    const locale = context?.locale || 'en-IN';

    const variants: BookVariantResponseDto[] = (book.formats || []).map((variant) => {
      let priceAmount = variant.price;
      let priceCurrency = 'INR';

      // Check priceMap for currency-specific price
      if (variant.priceMap && variant.priceMap[currency]) {
        priceAmount = variant.priceMap[currency];
        priceCurrency = currency;
      }

      // Format display string
      const display = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: priceCurrency,
      }).format(priceAmount);

      return {
        id: variant.id,
        format: variant.format,
        isPhysical: isPhysicalFormat(variant.format as any),
        price: {
          amount: priceAmount,
          currency: priceCurrency,
          display,
        },
        stockQuantity: variant.stockQuantity,
        reservedQuantity: variant.reservedQuantity,
        fileUrl: variant.fileUrl ?? undefined,
        isbn: variant.isbn ?? undefined,
      };
    });

    return {
      id: book.id,
      title: book.title,
      subtitle: book.subtitle ?? undefined,
      slug: book.slug ?? '',
      authorName: book.authorName ?? undefined,
      genre: book.genre,
      // publisher: book.publisher, // Missing in entity
      // publishedDate: book.publishedDate, // Missing in entity
      publishedDate: book.createdAt, // Fallback
      description: book.description ?? '',
      // longDescription: book.longDescription, // Missing in entity
      coverImageUrl: book.coverImageUrl ?? undefined,
      snapshotUrls: book.snapshotUrls ?? undefined,
      rating: 0, // Missing in entity, default to 0
      isBestseller: book.isBestseller,
      isFeatured: book.isFeatured,
      isNewRelease: book.isNewRelease,
      variants,
      visibility: book.visibility as any,
      isArchived: book.isArchived,
      bullets: book.bullets,
      shortDescription: book.shortDescription,
      ageGroupIds: book.ageGroups?.map(ag => ag.id) ?? [],
      categoryIds: book.categories?.map(c => c.id) ?? [],
      tagIds: book.tags?.map(t => t.id) ?? [],
    };
  }

  /**
   * Update a book (hybrid).
   *
   * - Partial book fields are merged.
   * - Cover & snapshots replaced only if files provided.
   * - Variants are hybrid-updated:
   *    - variant.id -> update
   *    - no id -> create
   *    - variants not present in DTO -> delete
   * - Variant files mapping: variantFiles[i] -> variants[i]
   *
   * @param bookId - uuid of book
   * @param dto - UpdateBookDto (partial)
   * @param files - optional files:
   *   { bookCover?: Express.Multer.File, snapshots?: Express.Multer.File[], variantFiles?: Express.Multer.File[] }
   */
  async updateBook(
    bookId: string,
    dto: UpdateBookDto,
    files?: {
      bookCover?: Express.Multer.File;
      snapshots?: Express.Multer.File[];
      variantFiles?: Express.Multer.File[]; // index -> dto.variants index
    },
  ): Promise<Book> {
    // --- 0. Basic guards
    if (!bookId) throw new BadRequestException('bookId is required');
    if (!dto && !files) throw new BadRequestException('Nothing to update');

    // Load current book with variants (we need variants to compute diffs)
    const existing = await this.bookRepository.findOne({
      where: { id: bookId },
      relations: ['formats', 'categories', 'tags', 'author'],
    });

    if (!existing) throw new NotFoundException(`Book ${bookId} not found`);

    // Prepare trackers for storage ops
    const newlyUploadedKeys: string[] = []; // keys of newly uploaded files (to cleanup if failure)
    const oldKeysToDeleteAfterCommit: string[] = []; // old keys we will delete only after DB commit

    // Prepare new URLs (if uploaded)
    let newCoverUrl: string | undefined;
    let newSnapshotUrls: string[] | undefined;
    const variantNewFileUrls: Array<string | null> = dto.variants ? new Array(dto.variants.length).fill(null) : [];

    const extractKey = (url?: string | null) => {
      try {
        return this.extractStorageKeyFromUrl(url ?? null);
      } catch {
        return null;
      }
    };

    // --- 1. Upload provided files (cover, snapshots, variant files)
    try {
      // 1.a cover
      if (files?.bookCover) {
        const payload = [
          {
            buffer: files.bookCover.buffer,
            filename: files.bookCover.originalname,
            mimetype: files.bookCover.mimetype,
          },
        ];
        const [url] = await this.uploadBookFilesProvider.uploadBuffers(payload);
        newCoverUrl = url;
        const k = extractKey(url);
        if (k) newlyUploadedKeys.push(k);

        // schedule deletion of old cover AFTER commit
        if (existing.coverImageUrl) {
          const oldKey = extractKey(existing.coverImageUrl);
          if (oldKey) oldKeysToDeleteAfterCommit.push(oldKey);
        }
      }

      // 1.b snapshots
      if (files?.snapshots?.length) {
        const payload = files.snapshots.map((f) => ({
          buffer: f.buffer,
          filename: f.originalname,
          mimetype: f.mimetype,
        }));
        const urls = await this.uploadBookFilesProvider.uploadBuffers(payload);
        newSnapshotUrls = urls;
        for (const u of urls) {
          const k = extractKey(u);
          if (k) newlyUploadedKeys.push(k);
        }

        // mark existing snapshot urls for deletion after commit (optional)
        if (existing.snapshotUrls?.length) {
          for (const u of existing.snapshotUrls) {
            const oldKey = extractKey(u);
            if (oldKey) oldKeysToDeleteAfterCommit.push(oldKey);
          }
        }
      }

      // 1.c variant files (index-based)
      if (files?.variantFiles?.length && dto.variants?.length) {
        const variantFiles = files.variantFiles;
        // try batch upload for docs if provider supports it
        if (typeof this.uploadBookFilesProvider.uploadPdfs === 'function') {
          const urls = await this.uploadBookFilesProvider.uploadPdfs(variantFiles);
          for (let i = 0; i < Math.min(urls.length, variantNewFileUrls.length); i++) {
            variantNewFileUrls[i] = urls[i];
            const k = extractKey(urls[i]);
            if (k) newlyUploadedKeys.push(k);

            // schedule deletion of old variant file (if variant exists with id)
            const vDto = dto.variants[i];
            if (vDto?.id) {
              const existingVariant = existing.formats?.find((v) => v.id === vDto.id);
              if (existingVariant?.fileUrl) {
                const oldKey = extractKey(existingVariant.fileUrl);
                if (oldKey) oldKeysToDeleteAfterCommit.push(oldKey);
              }
            }
          }
        } else {
          // fallback: upload individually
          for (let i = 0; i < Math.min(variantFiles.length, variantNewFileUrls.length); i++) {
            const f = variantFiles[i];
            const [url] = await this.uploadBookFilesProvider.uploadBuffers([
              {
                buffer: f.buffer,
                filename: f.originalname,
                mimetype: f.mimetype,
              },
            ]);
            variantNewFileUrls[i] = url;
            const k = extractKey(url);
            if (k) newlyUploadedKeys.push(k);

            const vDto = dto.variants[i];
            if (vDto?.id) {
              const existingVariant = existing.formats?.find((v) => v.id === vDto.id);
              if (existingVariant?.fileUrl) {
                const oldKey = extractKey(existingVariant.fileUrl);
                if (oldKey) oldKeysToDeleteAfterCommit.push(oldKey);
              }
            }
          }
        }
      }
    } catch (uploadErr) {
      // If upload fails, attempt to cleanup newly uploaded keys and throw
      this.logger.error('updateBook: upload failed, cleaning up new uploads', uploadErr);
      if (newlyUploadedKeys.length && typeof this.uploadBookFilesProvider.deleteObjects === 'function') {
        try {
          await this.uploadBookFilesProvider.deleteObjects(newlyUploadedKeys);
        } catch (cleanupErr) {
          this.logger.error('updateBook: failed to cleanup partially uploaded assets', cleanupErr);
        }
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to upload assets for update',
          error: (uploadErr as Error).message ?? String(uploadErr),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // --- 2. Prepare DB changes and run inside a transaction
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // 2.a merge book-level partial fields
      const bookRepo = qr.manager.getRepository(Book);
      const bookPatch: Partial<Book> = {};

      // Only set fields if provided in dto
      const updatableFields: Array<keyof UpdateBookDto> = [
        'title',
        'subtitle',
        'description',
        'genre',
        'authorId',
        'authorName',
        'slug',
        'metaTitle',
        'metaDescription',
        'isBestseller',
        'isFeatured',
        'isNewRelease',
        'allowReviews',
        'allowWishlist',
        'allowWishlist',
        'visibility',
        // 'categoryIds', // Removing these from simple fields as they are relations
        // 'tagIds',
        'snapshots',
        'coverImageUrl',
        'bullets',
        'shortDescription'
      ] as any;

      // Handle Age Groups
      if (dto.ageGroupIds) {
        const ageGroupsRepo = qr.manager.getRepository<AgeGroup>(AgeGroup);
        const ageGroups = await ageGroupsRepo.findBy({
          id: In(dto.ageGroupIds),
        });
        bookPatch.ageGroups = ageGroups;
      }

      // Handle Categories (if provided)
      if (dto.categoryIds) {
        const categoryRepo = qr.manager.getRepository<Category>(Category);
        const categories = await categoryRepo.findBy({
          id: In(dto.categoryIds),
        });
        bookPatch.categories = categories;
      }

      // Handle Tags (if provided)
      if (dto.tagIds) {
        const tagRepo = qr.manager.getRepository<Tag>(Tag);
        const tags = await tagRepo.findBy({
          id: In(dto.tagIds),
        });
        bookPatch.tags = tags;
      }

      for (const f of updatableFields) {
        if ((dto as any)[f] !== undefined) {
          // map camelCase DTO -> entity fields if naming differs
          (bookPatch as any)[f === 'metaTitle' ? 'metaTitle' : f] = (dto as any)[f];
        }
      }

      // Attach uploaded new URLs if any (replace behavior)
      if (newCoverUrl) {
        bookPatch.coverImageUrl = newCoverUrl;
      } else if (dto.coverImageUrl !== undefined) {
        // If no file uploaded but URL provided in DTO
        bookPatch.coverImageUrl = dto.coverImageUrl;
      }

      if (newSnapshotUrls) {
        bookPatch.snapshotUrls = newSnapshotUrls;
        bookPatch.snapshots = newSnapshotUrls;
      } else if (dto.snapshots) {
        // If no files uploaded but URLs provided in DTO
        bookPatch.snapshotUrls = dto.snapshots;
        bookPatch.snapshots = dto.snapshots;
      }

      // update the book
      // update the book
      const merged = bookRepo.merge(existing, bookPatch);
      // Explicitly assign relations to ensure merge didn't drop them
      if (bookPatch.ageGroups) merged.ageGroups = bookPatch.ageGroups;
      if (bookPatch.categories) merged.categories = bookPatch.categories;
      if (bookPatch.tags) merged.tags = bookPatch.tags;

      const savedBook = await qr.manager.save(merged);

      // --- 3. Variants Update Logic (Hybrid: Match by ID -> Match by Format -> Create New -> Delete Leftovers)
      const variantsToCreate: Partial<BookFormatVariant>[] = [];
      const variantsToUpdate: { entity: BookFormatVariant; dto: any; fileUrl?: string | null }[] = [];

      // Track which existing variants are "claimed" by the incoming DTO
      const claimedExistingIds = new Set<number>();

      // 3.a Process incoming DTO variants
      if (dto.variants) {
        dto.variants.forEach((vDto, i) => {
          let matchedVariant: BookFormatVariant | undefined;

          // Strategy 1: Match by ID (Explicit)
          if (vDto.id) {
            matchedVariant = existing.formats?.find(ev => ev.id === vDto.id);
          }

          // Strategy 2: Match by Format (Implicit, if ID not provided or not found)
          // Only match if this existing variant hasn't been claimed yet
          if (!matchedVariant && vDto.format) {
            matchedVariant = existing.formats?.find(ev =>
              ev.format === vDto.format && !claimedExistingIds.has(ev.id)
            );
          }

          if (matchedVariant) {
            // Update existing
            claimedExistingIds.add(matchedVariant.id);
            variantsToUpdate.push({
              entity: matchedVariant,
              dto: vDto,
              fileUrl: variantNewFileUrls[i]
            });
          } else {
            // Create new
            const createPayload: Partial<BookFormatVariant> = {
              book: savedBook,
              format: vDto.format,
              price: (vDto as any).priceCents !== undefined ? (vDto as any).priceCents / 100 : 0,
              stockQuantity: isPhysicalFormat(vDto.format as any) ? (vDto.stockQuantity ?? 0) : 0,
              reservedQuantity: 0,
              fileUrl: variantNewFileUrls[i] ?? vDto.fileUrl ?? null,
              isbn: vDto.isbn ?? null,
            };
            variantsToCreate.push(createPayload);
          }
        });
      }

      // 3.b Apply Updates
      for (const item of variantsToUpdate) {
        const { entity, dto: vDto, fileUrl } = item;
        const updatePayload: Partial<BookFormatVariant> = {};

        if (vDto.format !== undefined) updatePayload.format = vDto.format;
        if ((vDto as any).priceCents !== undefined) updatePayload.price = (vDto as any).priceCents / 100;
        if (vDto.stockQuantity !== undefined) {
          const effectiveFormat = vDto.format ?? entity.format;
          updatePayload.stockQuantity = isPhysicalFormat(effectiveFormat as any) ? vDto.stockQuantity : 0;
        }
        if (vDto.isbn !== undefined) updatePayload.isbn = vDto.isbn;

        // Replace fileUrl if a new file was uploaded
        if (fileUrl) {
          updatePayload.fileUrl = fileUrl;
          // Mark old file for deletion
          if (entity.fileUrl) {
            const k = extractKey(entity.fileUrl);
            if (k) oldKeysToDeleteAfterCommit.push(k);
          }
        } else if (vDto.fileUrl !== undefined) {
          // If DTO explicitly sends fileUrl string (or null)
          updatePayload.fileUrl = vDto.fileUrl;
        }

        await qr.manager.update(BookFormatVariant, { id: entity.id }, updatePayload);
      }

      // 3.c Create New
      if (variantsToCreate.length > 0) {
        await qr.manager.save(BookFormatVariant, variantsToCreate);
      }

      // 3.d Delete Unclaimed (only if variants were provided in DTO)
      if (dto.variants !== undefined) {
        const variantsToDelete = existing.formats?.filter(ev => !claimedExistingIds.has(ev.id)) ?? [];
        if (variantsToDelete.length > 0) {
          const deleteIds = variantsToDelete.map(v => v.id);
          await qr.manager.delete(BookFormatVariant, deleteIds);

          // schedule deletion of files for deleted variants after commit
          for (const v of variantsToDelete) {
            if (v.fileUrl) {
              const k = extractKey(v.fileUrl);
              if (k) oldKeysToDeleteAfterCommit.push(k);
            }
          }
        }
      }

      // 2.c commit
      await qr.commitTransaction();

      // --- 3. Post-commit cleanup: delete old keys (best-effort)
      if (oldKeysToDeleteAfterCommit.length && typeof this.uploadBookFilesProvider.deleteObjects === 'function') {
        try {
          await this.uploadBookFilesProvider.deleteObjects(oldKeysToDeleteAfterCommit);
        } catch (cleanupErr) {
          this.logger.error('updateBook: failed to delete old files after commit', cleanupErr);
          // do not fail the API — cleanup is best-effort
        }
      }

      // Return reloaded book with relations
      const updated = await this.bookRepository.findOne({
        where: { id: savedBook.id },
        relations: ['formats', 'categories', 'tags', 'metrics', 'author', 'ageGroups'],
      });

      this.logger.log(`updateBook: updated book ${savedBook.id}`);
      return updated!;
    } catch (dbErr) {
      // rollback & cleanup newly uploaded keys (best-effort)
      await qr.rollbackTransaction();
      this.logger.error('updateBook: DB transaction failed, rolling back', dbErr);

      if (newlyUploadedKeys.length && typeof this.uploadBookFilesProvider.deleteObjects === 'function') {
        try {
          await this.uploadBookFilesProvider.deleteObjects(newlyUploadedKeys);
        } catch (cleanupErr) {
          this.logger.error('updateBook: failed to cleanup newly uploaded assets after rollback', cleanupErr);
        }
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update book',
          error: (dbErr as Error).message ?? String(dbErr),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await qr.release();
    }
  }

  async deleteBook(id: string, options: DeleteOption) {
    const result = await this.deleteBookProvider.deleteBook(id, options);
    return result;
  }

  async putBook(_id: number, _data: any) {
    //eslint-disable-line
    return '';
  }
}
