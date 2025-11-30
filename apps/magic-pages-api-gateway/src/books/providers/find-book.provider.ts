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
      q,
      ageGroups,
      categories,
      isFeatured,
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
        'book.genre',
        'book.description',
        'book.isNewRelease',
        'book.slug',
        'book.metaTitle',
        'book.metaDescription',
        'book.coverImageUrl',
        'book.isBestseller',
        'book.isFeatured',
        'book.visibility',
        'book.ageGroup',
        'book.createdAt',
      ])
        .addSelect(subQuery => {
          return subQuery
            // json_agg collects all results into an array
            .select(`json_agg(
              json_build_object(
                'id', variant.id,
                'format', variant.format,
                'price', variant.price,
                'stockQuantity', variant."stockQuantity",
                'reservedQuantity', variant."reservedQuantity",
                'fileUrl', variant."fileUrl",
                'isbn', variant."isbn"
              ) ORDER BY variant.price ASC
            )`, 'variants')
            .from('book_format_varients', 'variant')
            .where('variant.book_id = book.id');
        }, 'variantsRaw'); // This alias appears in 'raw' results
      ;

      // --- Filters ---

      // 1. Search (q) - Fuzzy match on Title, Author, Description
      if (q && q.trim().length > 0) {
        const searchTerm = `%${q.trim().toLowerCase()}%`;
        qb.andWhere(
          '(LOWER(book.title) LIKE :q OR LOWER(book.authorName) LIKE :q OR LOWER(book.description) LIKE :q)',
          { q: searchTerm },
        );
      }

      // 2. Age Groups (Many-to-Many)
      if (ageGroups && ageGroups.length > 0) {
        qb.innerJoin('book.ageGroups', 'ag', 'ag.id IN (:...ageGroups)', { ageGroups });
      }

      // 3. Categories (Many-to-Many)
      if (categories && categories.length > 0) {
        qb.innerJoin('book.categories', 'cat', 'cat.slug IN (:...categories) OR cat.id IN (:...categories)', {
          categories,
        });
      }

      if (isFeatured !== undefined) {
        qb.andWhere('book.isFeatured = :isFeatured', { isFeatured });
      }

      if (genre) qb.andWhere('book.genre = :genre', { genre });

      if (formats && formats.length > 0) {
        qb.innerJoin('book.formats', 'fmt', 'fmt.format IN (:...formats)', { formats });
      }

      // if (availability) qb.andWhere('book.availability = :availability', { availability });

      if (authorName) {
        qb.andWhere('LOWER(book.authorName) LIKE :authorName', {
          authorName: `%${authorName.toLowerCase()}%`,
        });
      }

      // Price and Rating are on variants or metrics, not on Book. 
      // For MVP, disabling these filters on Book level.
      /*
      if (minPrice !== undefined) qb.andWhere('book.price >= :minPrice', { minPrice });
      if (maxPrice !== undefined) qb.andWhere('book.price <= :maxPrice', { maxPrice });
      if (minRating !== undefined) qb.andWhere('book.rating >= :minRating', { minRating });
      if (maxRating !== undefined) qb.andWhere('book.rating <= :maxRating', { maxRating });
      */

      // Sorting & pagination
      // Only allow sorting by fields that exist on Book
      const validSortFields = new Set(['createdAt', 'updatedAt', 'title', 'isBestseller', 'isFeatured', 'publishedDate']);
      const effectiveOrderField = validSortFields.has(orderField) ? orderField : 'createdAt';

      qb.orderBy(`book.${effectiveOrderField}`, orderDirection);

      // Pagination
      qb.skip(skip).take(safeLimit);

      // Use getRawAndEntities to get both entity data and computed minPrice
      const { entities, raw } = await qb.getRawAndEntities();
      const total = await qb.getCount();

      // Map minPrice from raw results to entities
      const data = entities.map((book) => {
        const rawRow = raw.find((r) => r.book_id === book.id);

        if (rawRow && rawRow.variantsRaw) {
          (book as any).variants = rawRow.variantsRaw;
        }

        return book;
      });

      const totalPages = Math.ceil(total / safeLimit);

      // --- Facets Aggregation ---
      // We clone the query builder *before* pagination but *after* filters to get accurate counts for the current result set.

      const facets = {
        ageGroups: [] as { id: string; count: number }[],
        categories: [] as { id: string; name: string; count: number }[],
        formats: [] as { id: string; count: number }[],
      };

      // Run facet queries in parallel
      const [ageGroupCounts, categoryCounts, formatCounts] = await Promise.all([
        // 1. Age Groups
        qb.clone()
          .orderBy() // Clear ordering
          .innerJoin('book.ageGroups', 'ag_facet')
          .select('ag_facet.id', 'id')
          .addSelect('COUNT(DISTINCT book.id)', 'count')
          .groupBy('ag_facet.id')
          .getRawMany(),

        // 2. Categories
        qb.clone()
          .orderBy() // Clear ordering
          .innerJoin('book.categories', 'cat_facet')
          .select('cat_facet.id', 'id')
          .addSelect('cat_facet.name', 'name')
          .addSelect('COUNT(DISTINCT book.id)', 'count')
          .groupBy('cat_facet.id')
          .addGroupBy('cat_facet.name')
          .getRawMany(),

        // 3. Formats
        qb.clone()
          .orderBy() // Clear ordering
          .innerJoin('book.formats', 'fmt_facet')
          .select('fmt_facet.format', 'id')
          .addSelect('COUNT(DISTINCT book.id)', 'count')
          .groupBy('fmt_facet.format')
          .getRawMany(),
      ]);

      facets.ageGroups = ageGroupCounts.map(r => ({ id: r.id, count: Number(r.count) }));
      facets.categories = categoryCounts.map(r => ({ id: r.id, name: r.name, count: Number(r.count) }));
      facets.formats = formatCounts.map(r => ({ id: r.id, count: Number(r.count) }));

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
        facets
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
  async findOne(id: string, opts?: FindOneBookOption & { isAdmin?: boolean }): Promise<Book> {
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
  public async findByTitle(rawTitle: string): Promise<Book | null> {
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
        this.logger.warn(`findByTitle("${title}") executed slowly: ${duration}ms`);
      }

      return result ?? null;
    } catch (err) {
      // Hard failure is logged but not thrown.
      this.logger.error(`Unexpected failure in findByTitle("${title}")`, err?.stack ?? err);
      return null;
    }
  }

  /**
   * findByTitles
   *
   * Responsibilities:
   *  - Efficiently lookup multiple books by their titles in a single query.
   *  - Return a minimal projection suitable for uniqueness validation or mapping.
   *  - Normalize all incoming titles to ensure predictable matching.
   *
   * Contract:
   *  - Returns: Book[]
   *  - Never throws on "not found" or invalid inputs.
   *
   * Rationale:
   *  This is a bulk version of findByTitle(), optimized to avoid N+1 lookups.
   *  The method aims for correctness, protective normalization, and reliably
   *  non-throwing behavior while maintaining a clean interface.
   *
   *  Matching is case-insensitive and whitespace-normalized.
   */
  public async findByTitles(rawTitles: string[]): Promise<Book[]> {
    if (!Array.isArray(rawTitles) || rawTitles.length === 0) {
      this.logger.warn('findByTitles() called with empty or invalid title list.');
      return [];
    }

    // Normalize: trim, lowercase for consistent comparison
    const normalizedTitles = rawTitles.map((t) => t?.trim()).filter(Boolean) as string[];

    if (normalizedTitles.length === 0) {
      this.logger.warn('findByTitles() received titles, but all were empty or invalid after normalization.');
      return [];
    }

    const started = Date.now();

    try {
      // Use LOWER() for case-insensitive match.
      const qb = this.bookRepository
        .createQueryBuilder('book')
        .select(['book.id', 'book.title'])
        .where('LOWER(book.title) IN (:...titles)', {
          titles: normalizedTitles.map((t) => t.toLowerCase()),
        })
        .andWhere('book.deletedAt IS NULL');

      const results = await qb.getMany();

      const duration = Date.now() - started;
      if (duration > 80) {
        // Slow-path detection for bulk queries
        this.logger.warn(`findByTitles() executed slowly: ${duration}ms for ${normalizedTitles.length} titles.`);
      }

      return results;
    } catch (err) {
      // Log the failure but follow the non-throwing contract
      this.logger.error(`Unexpected failure in findByTitles()`, err?.stack ?? err);
      return [];
    }
  }
}
