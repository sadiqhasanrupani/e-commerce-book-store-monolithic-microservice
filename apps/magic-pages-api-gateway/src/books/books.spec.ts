import { Test, TestingModule } from '@nestjs/testing';
import { BooksService } from './providers/books.service';
import { FindBookProvider } from './providers/find-book.provider';
import { CreateBookProvider } from './providers/create-book.provider';
import { UploadBookFilesProvider } from './providers/upload-book-files.provider';
import { DeleteBookProvider } from './providers/delete-book.provider';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Book } from '@app/contract/books/entities/book.entity';
import { DataSource } from 'typeorm';
import { UserContext } from '../auth/providers/user-context.service';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';

describe('BooksService Integration (Pricing Logic)', () => {
  let booksService: BooksService;
  let findBookProvider: FindBookProvider;

  const mockBook = {
    id: 'book-1',
    title: 'Test Book',
    formats: [
      {
        id: 1,
        format: BookFormat.HARDCOVER,
        price: 1000, // Default INR 1000
        priceMap: {
          USD: 20,
          EUR: 18,
        },
        stockQuantity: 10,
        reservedQuantity: 0,
        fileUrl: 'http://example.com/file.pdf',
        isbn: '1234567890',
      },
    ],
  } as any;

  const mockFindBookProvider = {
    findOne: jest.fn().mockResolvedValue(mockBook),
    findAll: jest.fn().mockResolvedValue({ data: [mockBook], meta: {} }),
  };

  beforeEach(async () => {
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
    findBookProvider = module.get<FindBookProvider>(FindBookProvider);
  });

  it('should return default INR price when no user context is provided', async () => {
    const result = await booksService.findOne('book-1');

    expect(result.variants[0].price.currency).toBe('INR');
    expect(result.variants[0].price.amount).toBe(1000);
    // Intl output depends on system locale, but usually "₹1,000.00" or similar
    expect(result.variants[0].price.display).toContain('₹');
  });

  it('should return USD price when UserContext is US', async () => {
    const userContext: UserContext = {
      countryCode: 'US',
      currency: 'USD',
      locale: 'en-US',
    };

    const result = await booksService.findOne('book-1', { userContext });

    expect(result.variants[0].price.currency).toBe('USD');
    expect(result.variants[0].price.amount).toBe(20);
    expect(result.variants[0].price.display).toContain('$20.00');
  });

  it('should return EUR price when UserContext is DE', async () => {
    const userContext: UserContext = {
      countryCode: 'DE',
      currency: 'EUR',
      locale: 'de-DE',
    };

    const result = await booksService.findOne('book-1', { userContext });

    expect(result.variants[0].price.currency).toBe('EUR');
    expect(result.variants[0].price.amount).toBe(18);
    // de-DE format: 18,00 €
    expect(result.variants[0].price.display).toContain('18,00');
  });

  it('should fallback to default price if currency not in priceMap', async () => {
    const userContext: UserContext = {
      countryCode: 'JP',
      currency: 'JPY',
      locale: 'ja-JP',
    };

    const result = await booksService.findOne('book-1', { userContext });

    // Should fall back to variant.price (1000) but formatted as JPY? 
    // Wait, the logic is: 
    // if (variant.priceMap && variant.priceMap[currency]) { ... } 
    // else { priceAmount = variant.price; priceCurrency = 'INR'; }
    // So it should be INR 1000, but displayed in en-IN locale?
    // Actually the code says:
    // const locale = context?.locale || 'en-IN';
    // const display = new Intl.NumberFormat(locale, { style: 'currency', currency: priceCurrency }).format(priceAmount);

    expect(result.variants[0].price.currency).toBe('INR');
    expect(result.variants[0].price.amount).toBe(1000);
    // It will format INR 1000 using ja-JP locale
    // We just check the currency code in the object
  });
});
