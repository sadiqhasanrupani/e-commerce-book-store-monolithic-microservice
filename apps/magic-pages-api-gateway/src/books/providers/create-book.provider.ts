import { Injectable, ConflictException, BadRequestException, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { extractStorageKeyFromUrl } from '@app/contract/books/utils/books.util';

// DTOs
import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';

// entities
import { Book } from '@app/contract/books/entities/book.entity';

import { FindBookProvider } from './find-book.provider';
import { UploadBookFilesProvider } from './upload-book-files.provider';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';

@Injectable()
export class CreateBookProvider {
  private readonly logger = new Logger(CreateBookProvider.name);

  constructor(
    @InjectRepository(Book)
    private readonly bookRepository: Repository<Book>,

    private readonly findBookProvider: FindBookProvider,
    private readonly uploadBookFilesProvider: UploadBookFilesProvider,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Create book with DB-level protection against race conditions.
   */
  //   try {
  // public async createBook(dto: CreateBookDto): Promise<Book> {
  //     const entity = this.repo.create(dto);
  //     return await this.repo.save(entity);
  //   } catch (err) {
  //     // PostgreSQL duplicate key violation (title unique)
  //     if (err?.code === '23505') {
  //       throw new ConflictException(
  //         `A book with the title "${dto.title}" already exists (database constraint).`,
  //       );
  //     }
  //
  //     throw new InternalServerErrorException(
  //       'Unexpected failure while saving the book.',
  //     );
  //   }
  // }

  /**
   * Bulk create books (atomic) — optimized, safe, low complexity.
   *
   * Behavior summary:
   * 1) Validate input & ensure uniqueness of titles in a single DB call (fail-fast).
   * 2) Upload all files with bounded concurrency per book (covers, snapshots, variant files).
   * 3) If all uploads succeed, persist all books and variants inside a single DB transaction
   *    using batch saves (save(array)) to minimise DB roundtrips.
   * 4) If any upload or DB step fails, rollback DB and attempt best-effort deletion of uploaded objects.
   *
   * Complexity: O(B + V) where B = #books, V = #variants total. Upload and DB operations are batched.
   *
   * @param inputs array of { createBookDto: CreateBookDto, files?: { bookCover?: File, snapshots?: File[], variantFiles?: File[] } }
   * @param options.optional: concurrency (number of parallel upload workers, default = 5)
   */
  async bulkCreate(
    inputs: Array<{
      createBookDto: CreateBookDto;
      files?: {
        bookCover?: Express.Multer.File;
        snapshots?: Express.Multer.File[];
        variantFiles?: Express.Multer.File[]; // index -> variant
      };
    }>,
    options?: { concurrency?: number },
  ): Promise<Book[]> {
    const concurrency = options?.concurrency ?? 5;

    // Basic guards
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new BadRequestException('inputs must be a non-empty array');
    }

    // Extract titles and validate at once
    const titles = inputs.map((i) => (i.createBookDto.title || '').trim());
    if (titles.some((t) => !t)) {
      throw new BadRequestException('Each book must have a non-empty title');
    }

    // 1) Check title uniqueness in one DB hit (fail-fast)
    const existing = await this.findBookProvider.findByTitles(titles); // implement to return array of titles (or rows)
    if (existing?.length) {
      // pick first collision for clarity
      const conflictTitle = Array.isArray(existing) ? (existing[0].title ?? existing[0]) : existing;
      throw new ConflictException(`A book with title "${conflictTitle}" already exists`);
    }

    /**
     * Upload phase
     * We implement bounded concurrency using a simple worker pool pattern.
     * For each input we produce an UploadResult { coverUrl, snapshotUrls[], variantFileUrls[], uploadedKeys[] }.
     */
    type UploadResult = {
      coverUrl?: string | null;
      snapshotUrls: string[];
      variantFileUrls: Array<string | null>; // same length as dto.variants
      uploadedKeys: string[]; // storage keys (for cleanup on failure)
    };

    const uploadResults: UploadResult[] = new Array(inputs.length);

    // Helper: extract key from URL (reuse your existing helper)
    const extractKey = (u?: string | null) => {
      try {
        // reuse your existing method; if not available, simple fallback:
        return extractStorageKeyFromUrl(u ?? null);
      } catch {
        return null;
      }
    };

    // Helper: upload one book's files
    const uploadOneBook = async (
      dto: CreateBookDto,
      files?: {
        bookCover?: Express.Multer.File;
        snapshots?: Express.Multer.File[];
        variantFiles?: Express.Multer.File[];
      },
    ): Promise<UploadResult> => {
      const uploadedKeys: string[] = [];
      const snapshotUrls: string[] = [];
      const variantFileUrls: Array<string | null> = new Array(dto.variants.length).fill(null);
      let coverUrl: string | null = null;

      // 1) cover image (single)
      if (files?.bookCover) {
        const payload = [
          {
            buffer: files.bookCover.buffer,
            filename: files.bookCover.originalname,
            mimetype: files.bookCover.mimetype,
          },
        ];
        const [url] = await this.uploadBookFilesProvider.uploadBuffers(payload);
        coverUrl = url;
        const k = extractKey(url);
        if (k) uploadedKeys.push(k);
      }

      // 2) snapshots (batch)
      if (files?.snapshots?.length) {
        const payload = files.snapshots.map((f) => ({
          buffer: f.buffer,
          filename: f.originalname,
          mimetype: f.mimetype,
        }));
        const urls = await this.uploadBookFilesProvider.uploadBuffers(payload);
        snapshotUrls.push(...urls);
        for (const u of urls) {
          const k = extractKey(u);
          if (k) uploadedKeys.push(k);
        }
      }

      // 3) variant files (ordered). Use uploadPdfs for batch if available, otherwise per-file upload.
      if (files?.variantFiles?.length) {
        const variantFiles = files.variantFiles;
        if (typeof this.uploadBookFilesProvider.uploadPdfs === 'function') {
          const urls = await this.uploadBookFilesProvider.uploadPdfs(variantFiles);
          for (let i = 0; i < Math.min(urls.length, variantFileUrls.length); i++) {
            variantFileUrls[i] = urls[i];
            const k = extractKey(urls[i]);
            if (k) uploadedKeys.push(k);
          }
        } else {
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
            const k = extractKey(url);
            if (k) uploadedKeys.push(k);
          }
        }
      }

      return {
        coverUrl,
        snapshotUrls,
        variantFileUrls,
        uploadedKeys,
      };
    };

    // Worker pool: process uploads with bounded concurrency to avoid DDoSing storage
    const queue = inputs.map((inp, idx) => ({ inp, idx }));
    const workers: Promise<void>[] = [];
    let qPos = 0;

    const worker = async () => {
      while (true) {
        const i = qPos++;
        if (i >= queue.length) return;
        const { inp, idx } = queue[i];
        try {
          uploadResults[idx] = await uploadOneBook(inp.createBookDto, inp.files);
        } catch (err) {
          // bubble up by throwing (we'll catch outside)
          throw { idx, err };
        }
      }
    };

    // start N workers
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      workers.push(worker());
    }

    // wait for uploads; if any worker throws, capture error
    try {
      await Promise.all(workers);
    } catch (uploadError) {
      // If any upload failed, attempt best-effort cleanup of successful uploads
      const toCleanup: string[] = [];
      for (const r of uploadResults) {
        if (r?.uploadedKeys?.length) toCleanup.push(...r.uploadedKeys);
      }
      if (toCleanup.length && typeof this.uploadBookFilesProvider.deleteObjects === 'function') {
        try {
          await this.uploadBookFilesProvider.deleteObjects(toCleanup);
        } catch (cleanupErr) {
          this.logger.error('bulkCreate: failed to cleanup after upload error', cleanupErr);
        }
      }
      // Re-throw a clean error
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Asset upload failed during bulk create',
          error: (uploadError as any).err?.message ?? String(uploadError),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 2) All uploads done successfully (uploadResults populated)
    // Build Book and Variant payloads for DB in memory (lightweight objects)
    const bookPayloads: Partial<Book>[] = inputs.map((item, idx) => {
      const dto = item.createBookDto;
      const ur = uploadResults[idx];
      return {
        title: dto.title,
        subtitle: dto.subtitle,
        description: dto.description,
        genre: dto.genre,
        authorId: dto.authorId ?? undefined,
        authorName: dto.authorName ?? dto.author?.name ?? undefined,
        coverImageUrl: ur?.coverUrl ?? dto.coverImageUrl ?? undefined,
        snapshotUrls: ur?.snapshotUrls && ur.snapshotUrls.length ? ur.snapshotUrls : dto.snapshotUrls,
        slug: dto.slug,
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        isBestseller: dto.isBestseller ?? false,
        isFeatured: dto.isFeatured ?? false,
        isNewRelease: dto.isNewRelease ?? false,
        allowReviews: dto.allowReviews ?? true,
        allowWishlist: dto.allowWishlist ?? true,
        visibility: dto.visibility ?? 'public',
      } as Partial<Book>;
    });

    // 3) Persist everything in a single transaction (atomic)
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    // collect all uploaded keys across books for cleanup on DB failure
    const allUploadedKeys = uploadResults.flatMap((r) => r?.uploadedKeys ?? []);

    try {
      // create book entities and bulk save
      const bookEntities = bookPayloads.map((p) => qr.manager.create(Book, p));
      const savedBooks = await qr.manager.save(Book, bookEntities); // saves array in batch where supported

      // Build variant entities for all books
      const allVariantEntities: any[] = []; // BookFormatVariant typed at runtime
      for (let bIndex = 0; bIndex < inputs.length; bIndex++) {
        const savedBook = savedBooks[bIndex];
        const dtoVariants = inputs[bIndex].createBookDto.variants;
        const ur = uploadResults[bIndex];
        for (let vIndex = 0; vIndex < dtoVariants.length; vIndex++) {
          const vDto = dtoVariants[vIndex];
          // Convert DTO priceCents -> numeric price if your entity uses numeric/decimal 'price'
          const priceValue = (vDto as any).priceCents !== undefined ? (vDto as any).priceCents / 100 : null;
          const variantPayload: Partial<any> = {
            book: savedBook,
            bookId: (savedBook as any).id,
            format: vDto.format,
            price: priceValue,
            stockQuantity: vDto.stockQuantity ?? 0,
            reservedQuantity: 0,
            fileUrl: ur.variantFileUrls[vIndex] ?? vDto.fileUrl ?? null,
            isbn: vDto.isbn ?? null,
            // createdAt/updatedAt handled by decorators
          };
          allVariantEntities.push(qr.manager.create(BookFormatVariant as any, variantPayload));
        }
      }

      // Save all variants in bulk
      // Note: TypeORM will issue multiple inserts; but passing array reduces calls and groups work
      if (allVariantEntities.length > 0) {
        await qr.manager.save(BookFormatVariant as any, allVariantEntities);
      }

      // Commit transaction
      await qr.commitTransaction();

      // Reload persisted books with relations for return (single query per book group)
      // To minimize DB hits, fetch all saved book IDs in one query with joins
      const savedBookIds = (savedBooks as Book[]).map((b) => b.id);
      const finalBooks = await this.bookRepository.find({
        where: savedBookIds.length ? { id: In(savedBookIds) } : {},
        relations: ['formats', 'categories', 'tags', 'metrics', 'author'],
      });

      this.logger.log(`bulkCreate: created ${finalBooks.length} books (variants total ${allVariantEntities.length})`);
      return finalBooks;
    } catch (dbErr) {
      // rollback and cleanup uploaded assets (best-effort)
      await qr.rollbackTransaction();
      this.logger.error('bulkCreate: DB transaction failed, rolling back', dbErr);

      if (allUploadedKeys.length && typeof this.uploadBookFilesProvider.deleteObjects === 'function') {
        try {
          await this.uploadBookFilesProvider.deleteObjects(allUploadedKeys);
        } catch (cleanupErr) {
          this.logger.error('bulkCreate: failed to cleanup uploaded assets after DB rollback', cleanupErr);
        }
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to persist books in bulk',
          error: (dbErr as Error).message ?? String(dbErr),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await qr.release();
    }
  }
}
