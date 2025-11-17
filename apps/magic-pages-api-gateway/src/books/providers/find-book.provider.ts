import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaginationProvider } from '../../common/pagination/providers/pagination.provider';
import { FindAllBookQueryParam, FindOneBookOption } from '@app/contract/books/types/find-book.type';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Book } from '@app/contract/books/entities/book.entity';

/**
 * FindBookProvider
 *
 * Responsible for retrieving books with robust pagination, filtering and sorting.
 * Designed for performance and safety:
 *  - Enforces visibility rules for normal users.
 *  - Allows admins to opt-in to archived/private records.
 *  - Uses limited projections for list endpoints to reduce payload and DB IO.
 *  - Delegates pagination implementation to PaginationProvider for reusability.
 */
@Injectable()
export class FindBookProvider {
  private readonly logger = new Logger(FindBookProvider.name);

  constructor(
    /**
     * Inject paginationProvider
     */
    private readonly paginationProvider: PaginationProvider,

    /**
     * Inject bookRepository
     */
    @InjectRepository(Book)
    private readonly bookRepository: Repository<Book>,
  ) { }

  /**
   * Build base query builder used by both findAll and findOne.
   *
   * @param includeArchived - whether to include archived records
   * @param includePrivate - whether to include private visibility
   */
  private baseQb(includeArchived = false, includePrivate = false): SelectQueryBuilder<Book> {
    const qb = this.bookRepository.createQueryBuilder('book');

    // Always ignore physically deleted rows
    qb.where('book.deletedAt IS NULL');

    // If not including archived, filter them out
    if (!includeArchived) {
      qb.andWhere('book.isArchived = false');
    }

    // Visibility: if caller didn't request private, only public books
    if (!includePrivate) {
      qb.andWhere('book.visibility = :visibility', { visibility: 'public' });
    }

    return qb;
  }

  /**
   * Find paginated list of books.
   *
   * Behavior:
   *  - Normal users: only `visibility = public` and `isArchived = false`.
   *  - Admin callers: can set `includeArchived` and `includePrivate` to true.
   *
   * Performance choices:
   *  - Selects a projection for list endpoints (avoid returning full text/large arrays).
   *  - Enforces a maximum `limit` to avoid large payloads.
   *
   * @param queryParams - filters, pagination and sorting options
   * @param options - runtime options (e.g., isAdmin)
   *
   * Returns `{ meta, data }` where `meta` contains pagination metadata.
   */
  async findAll(queryParams?: FindAllBookQueryParam, options?: { isAdmin?: boolean }) {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
      genre,
      formats,
      availability,
      authorName,
      minPrice,
      maxPrice,
      minRating,
      maxRating,
      includeArchived = false,
      visibility,
    } = queryParams || {};

    // runtime authorization: admins can override archive/visibility behavior
    const isAdmin = !!options?.isAdmin;
    const effectiveIncludeArchived = isAdmin ? includeArchived : false;
    const effectiveIncludePrivate = isAdmin
      ? visibility === 'private' || visibility === 'draft'
        ? true
        : false
      : false;

    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    const allowedSortFields = new Set([
      'createdAt',
      'updatedAt',
      'price',
      'rating',
      'genre',
      'publishedDate',
      'title',
      'isBestseller',
      'isFeatured',
    ]);
    const orderField = allowedSortFields.has(String(sortBy)) ? String(sortBy) : 'createdAt';
    const orderDirection = sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
      // Build query; use projection for list to keep IO low
      const qb = this.baseQb(effectiveIncludeArchived, effectiveIncludePrivate).select([
        'book.id',
        'book.title',
        'book.authorName',
        'book.price',
        'book.rating',
        'book.genre',
        'book.formats',
        'book.description',
        'book.isNewRelease',
        'book.availability',
        'book.coverImageUrl',
        'book.isBestseller',
        'book.isFeatured',
        'book.visibility',
        'book.createdAt',
      ]);

      // Apply filters
      if (genre) qb.andWhere('book.genre = :genre', { genre });
      if (formats) qb.andWhere('book.formats = :formats', { formats });
      if (availability) qb.andWhere('book.availability = :availability', { availability });

      if (authorName) {
        qb.andWhere('LOWER(book.authorName) LIKE :authorName', {
          authorName: `%${authorName.toLowerCase()}%`,
        });
      }

      if (minPrice !== undefined) qb.andWhere('book.price >= :minPrice', { minPrice });
      if (maxPrice !== undefined) qb.andWhere('book.price <= :maxPrice', { maxPrice });
      if (minRating !== undefined) qb.andWhere('book.rating >= :minRating', { minRating });
      if (maxRating !== undefined) qb.andWhere('book.rating <= :maxRating', { maxRating });

      // Sorting & pagination
      qb.orderBy(`book.${orderField}`, orderDirection);
      qb.skip(skip).take(safeLimit);

      // Use PaginationProvider to execute the query and get total count efficiently.
      // PaginationProvider is expected to return [rows, totalCount] using a performant method
      // (e.g., combined COUNT query or optimized window function depending on DB dialect).
      const [data, total] = await this.paginationProvider.paginateQuery({ page: safePage, limit: safeLimit }, qb);

      const totalPages = Math.ceil(total / safeLimit);

      return {
        meta: {
          total,
          totalPages,
          page: safePage,
          limit: safeLimit,
          hasNextPage: safePage < totalPages,
          hasPreviousPage: safePage > 1,
        },
        data,
      };
    } catch (err) {
      this.logger.error('Failed to fetch books list', err?.stack ?? err);
      throw new BadRequestException('Error while retrieving book list.');
    }
  }

  /**
   * Find one book by id.
   *
   * - Normal users: only public and non-archived books are returned.
   * - Admins may pass options.includeArchived=true or options.includePrivate=true to access others.
   *
   * This returns the full entity (all fields) because detail pages often require full payload.
   *
   * @param id - book id
   * @param opts - includeArchived and includePrivate flags (admins only)
   */
  async findOne(id: number, opts?: FindOneBookOption & { isAdmin?: boolean }): Promise<Book> {
    const isAdmin = !!opts?.isAdmin;
    const includeArchived = isAdmin ? !!opts?.includeArchived : false;
    const includePrivate = isAdmin ? !!opts?.includePrivate : false;

    try {
      const qb = this.baseQb(includeArchived, includePrivate)
        .andWhere('book.id = :id', { id })
        .leftJoinAndSelect('book.author', 'author'); // eager load author for detail

      const book = await qb.getOne();

      if (!book) {
        this.logger.warn(
          `Book not found or inaccessible. id=${id}, includeArchived=${includeArchived}, includePrivate=${includePrivate}`,
        );
        throw new NotFoundException('Book not found or not accessible.');
      }

      return book;
    } catch (err) {
      this.logger.error(`Failed to fetch book id=${id}`, err?.stack ?? err);
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException('Error while retrieving book.');
    }
  }

  /**
   * findByTitle
   *
   * Responsibilities:
   *  - Perform a highly efficient lookup of a book by its title.
   *  - Return a minimal projection for uniqueness checks.
   *  - Normalize incoming title to ensure predictable matching.
   *
   * Contract:
   *  - Returns: Book | null
   *  - Never throws on "not found".
   *
   * Rationale:
   *  This method is intentionally non-throwing because existence
   *  checks should be a pure boolean-style operation. The caller,
   *  not the repository, determines what constitutes an exceptional case.
   *
   *  Queries are case-insensitive and whitespace-normalized.
   */
  async findByTitle(rawTitle: string): Promise<Book | null> {
    // Defensive input normalization
    const title = rawTitle?.trim();
    if (!title) {
      this.logger.warn('findByTitle() called with empty or invalid title.');
      return null;
    }

    const qb = this.bookRepository
      .createQueryBuilder('book')
      .select(['book.id', 'book.title'])
      .where('LOWER(book.title) = LOWER(:title)', { title })
      .andWhere('book.deletedAt IS NULL')
      .limit(1);

    const started = Date.now();

    try {
      const result = await qb.getOne();

      const duration = Date.now() - started;
      if (duration > 50) {
        // Performance observability: slow-path detection
        this.logger.warn(
          `findByTitle("${title}") executed slowly: ${duration}ms`,
        );
      }

      return result ?? null;
    } catch (err) {
      // Hard failure is logged but not thrown.
      this.logger.error(
        `Unexpected failure in findByTitle("${title}")`,
        err?.stack ?? err,
      );
      return null;
    }
  }
}
