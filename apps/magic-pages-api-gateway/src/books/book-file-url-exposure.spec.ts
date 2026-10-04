import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { Book } from '@app/contract/books/entities/book.entity';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { BookGenre } from '@app/contract/books/enums/book-genres.enum';
import { BookResponseDto } from '@app/contract/books/dtos/book-response.dto';
import { BookVariantResponseDto } from '@app/contract/books/dtos/book-variant-response.dto';

import { BooksService } from './providers/books.service';
import { FindBookProvider } from './providers/find-book.provider';
import { CreateBookProvider } from './providers/create-book.provider';
import { UploadBookFilesProvider } from './providers/upload-book-files.provider';
import { DeleteBookProvider } from './providers/delete-book.provider';

const DIGITAL_FILE_URL = 'http://minio:9000/the-magic-pages/books/1712-paid-ebook.pdf';
const PHYSICAL_FILE_URL = 'http://minio:9000/the-magic-pages/books/1712-hardcover-notes.pdf';

/**
 * The paywall around a paid ebook is only as strong as the weakest response
 * that mentions its file.
 *
 * `GET /books` and `GET /books/:id` are unauthenticated storefront routes, and
 * `book_format_varients.fileUrl` is the storage URL of the product itself. If
 * that value appears in a public catalogue response, the whole purchase flow —
 * checkout, payment verification, the ownership-checked download endpoint — is
 * decorative, because the browse JSON already handed the file over.
 *
 * These tests pin the rule at the shared mapper every catalogue read goes
 * through (`BooksService.transformBookToResponse`), which is the single place
 * `findAll`, `findOne` and `findRelated` all converge on.
 */
describe('Book catalogue: digital fileUrl exposure', () => {
  let booksService: BooksService;

  const buildBook = (): Book =>
    ({
      id: 'book-1',
      title: 'Test Book',
      formats: [
        {
          id: 1,
          format: BookFormat.EBOOK,
          price: 500,
          priceMap: null,
          stockQuantity: 0,
          reservedQuantity: 0,
          fileUrl: DIGITAL_FILE_URL,
          isbn: null,
        },
        {
          id: 2,
          format: BookFormat.HARDCOVER,
          price: 1000,
          priceMap: null,
          stockQuantity: 10,
          reservedQuantity: 0,
          fileUrl: PHYSICAL_FILE_URL,
          isbn: '1234567890',
        },
      ],
    }) as unknown as Book;

  const mockFindBookProvider = {
    findOne: jest.fn(),
    findAll: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFindBookProvider.findOne.mockResolvedValue(buildBook());
    mockFindBookProvider.findAll.mockResolvedValue({ data: [buildBook()], meta: {} });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BooksService,
        { provide: FindBookProvider, useValue: mockFindBookProvider },
        { provide: CreateBookProvider, useValue: {} },
        { provide: UploadBookFilesProvider, useValue: {} },
        { provide: DeleteBookProvider, useValue: {} },
        { provide: getRepositoryToken(Book), useValue: {} },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    booksService = module.get<BooksService>(BooksService);
  });

  const variantOf = (book: BookResponseDto, format: BookFormat): BookVariantResponseDto => {
    // `BookVariantResponseDto.format` is a plain string on the response contract.
    const variant = book.variants.find((v) => v.format === String(format));
    if (!variant) throw new Error(`Test fixture is missing a ${format} variant`);
    return variant;
  };

  const digitalVariantOf = (book: BookResponseDto) => variantOf(book, BookFormat.EBOOK);
  const physicalVariantOf = (book: BookResponseDto) => variantOf(book, BookFormat.HARDCOVER);

  describe('public / unauthenticated callers', () => {
    it('does not return a digital variant file URL from findOne (the PDP)', async () => {
      const result = await booksService.findOne('book-1');

      expect(digitalVariantOf(result).fileUrl).toBeUndefined();
      // Serialised, the field must not be present at all — this is what the
      // storefront actually receives over the wire.
      expect(JSON.stringify(result)).not.toContain(DIGITAL_FILE_URL);
      expect(JSON.parse(JSON.stringify(digitalVariantOf(result)))).not.toHaveProperty('fileUrl');
    });

    it('does not return a digital variant file URL from findAll (browse/search)', async () => {
      const result = await booksService.findAll({ page: 1, limit: 10 });

      expect(digitalVariantOf(result.data[0]).fileUrl).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(DIGITAL_FILE_URL);
    });

    it('does not return a digital variant file URL from findRelated (PDP rail)', async () => {
      mockFindBookProvider.findOne.mockResolvedValue({ ...buildBook(), id: 'book-0', genre: BookGenre.FANTASY });

      const related = await booksService.findRelated('book-0');

      expect(related.length).toBeGreaterThan(0);
      expect(JSON.stringify(related)).not.toContain(DIGITAL_FILE_URL);
    });

    it('still returns everything the storefront legitimately renders', async () => {
      const result = await booksService.findOne('book-1');
      const digital = digitalVariantOf(result);

      // Stripping the file URL must not cost the PDP the variant itself: the
      // buy button needs id, format, price and stock.
      expect(digital.id).toBe(1);
      expect(digital.isPhysical).toBe(false);
      expect(digital.price.amount).toBe(500);
      expect(digital.stockQuantity).toBe(0);
    });

    it('leaves physical variants untouched, since their fileUrl is not a deliverable', async () => {
      const result = await booksService.findOne('book-1');

      expect(physicalVariantOf(result).fileUrl).toBe(PHYSICAL_FILE_URL);
    });
  });

  describe('admin callers', () => {
    /**
     * The admin book-edit form shows the currently attached file and offers to
     * replace it, so `/admin/books/:id` is the one context where the URL is
     * legitimately part of the payload. It sits behind the admin role guard.
     */
    it('returns the digital file URL for an admin findOne', async () => {
      const result = await booksService.findOne('book-1', { isAdmin: true });

      expect(digitalVariantOf(result).fileUrl).toBe(DIGITAL_FILE_URL);
    });

    it('returns the digital file URL for an admin findAll', async () => {
      const result = await booksService.findAll({ page: 1, limit: 10 }, { isAdmin: true });

      expect(digitalVariantOf(result.data[0]).fileUrl).toBe(DIGITAL_FILE_URL);
    });
  });

  /**
   * Client decision (2026-09-08): the storefront must not mention tax at all
   * unless an admin explicitly ticked "Include Tax" on the variant. The PDP
   * gates its "Inclusive of all taxes" copy on `includeTax`, so the flag has
   * to come through the same shared mapper — and `taxPercentage` must only
   * travel alongside it, never on its own.
   */
  describe('tax wording gate (includeTax / taxPercentage)', () => {
    it('defaults includeTax to false and omits taxPercentage when the admin never ticked it', async () => {
      const result = await booksService.findOne('book-1');
      const variant = physicalVariantOf(result);

      expect(variant.includeTax).toBe(false);
      expect(variant.taxPercentage).toBeUndefined();
      expect(JSON.parse(JSON.stringify(variant))).not.toHaveProperty('taxPercentage');
    });

    it('emits includeTax=true with a numeric taxPercentage when the admin ticked it', async () => {
      const book = buildBook();
      // Postgres `numeric` columns come back from TypeORM as strings.
      Object.assign(book.formats[1], { includeTax: true, taxPercentage: '18.00' });
      mockFindBookProvider.findOne.mockResolvedValue(book);

      const variant = physicalVariantOf(await booksService.findOne('book-1'));

      expect(variant.includeTax).toBe(true);
      expect(variant.taxPercentage).toBe(18);
      expect(typeof variant.taxPercentage).toBe('number');
    });

    it('withholds a stale taxPercentage when includeTax is false', async () => {
      const book = buildBook();
      Object.assign(book.formats[1], { includeTax: false, taxPercentage: '18.00' });
      mockFindBookProvider.findOne.mockResolvedValue(book);

      const variant = physicalVariantOf(await booksService.findOne('book-1'));

      expect(variant.includeTax).toBe(false);
      expect(variant.taxPercentage).toBeUndefined();
    });
  });
});
