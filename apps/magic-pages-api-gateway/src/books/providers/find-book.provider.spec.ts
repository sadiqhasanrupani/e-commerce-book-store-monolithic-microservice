import { Test, TestingModule } from '@nestjs/testing';
import { FindBookProvider } from './find-book.provider';
import { PaginationProvider } from '../../common/pagination/providers/pagination.provider';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Book } from '@app/contract/books/entities/book.entity';

const mockQueryBuilder = {
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
  getOne: jest.fn().mockResolvedValue(null),
  getCount: jest.fn().mockResolvedValue(0),
  getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  clone: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue([]),
  from: jest.fn().mockReturnThis(),
} as any;

mockQueryBuilder.clone.mockReturnValue(mockQueryBuilder);

describe('FindBookProvider', () => {
  let provider: FindBookProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FindBookProvider,
        {
          provide: PaginationProvider,
          useValue: {},
        },
        {
          provide: getRepositoryToken(Book),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          },
        },
      ],
    }).compile();

    provider = module.get<FindBookProvider>(FindBookProvider);
    jest.clearAllMocks();
  });

  it('should use Full-Text Search when q is provided and results exist', async () => {
    mockQueryBuilder.getCount.mockResolvedValue(1); // Simulate FTS hits

    await provider.findAll({ q: 'Harry', page: 1, limit: 10 });

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("websearch_to_tsquery"),
      expect.objectContaining({ q: 'Harry' })
    );
    expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
      expect.stringContaining("ts_rank"),
      "DESC"
    );
  });

  it('should fallback to Fuzzy Search when FTS returns 0', async () => {
    mockQueryBuilder.getCount.mockResolvedValue(0); // Simulate FTS miss

    await provider.findAll({ q: 'Hary', page: 1, limit: 10 });

    // First it tries FTS (clone)
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("websearch_to_tsquery"),
      expect.objectContaining({ q: 'Hary' })
    );

    // Then it should try Fuzzy
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("similarity"),
      expect.objectContaining({ q: 'Hary' })
    );

    expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
      expect.stringContaining("similarity"),
      "DESC"
    );
  });


  it('should include private books when admin requests visibility=all', async () => {
    mockQueryBuilder.getRawAndEntities.mockResolvedValue({ entities: [], raw: [] });
    mockQueryBuilder.getCount.mockResolvedValue(0);

    await provider.findAll(
      { visibility: 'all', page: 1, limit: 10 },
      { isAdmin: true }
    );

    // Should call baseQb with includePrivate = true
    // references line: if (!includePrivate) qb.andWhere('book.visibility = :visibility', { visibility: 'public' });
    // So if includePrivate is true, that line is skipped.

    // Let's verify that we DO NOT see the "book.visibility = 'public'" where clause
    const calls = mockQueryBuilder.andWhere.mock.calls;
    const hasPublicFilter = calls.some((args: any[]) =>
      args[0] && args[0].includes('book.visibility = :visibility') && args[1]?.visibility === 'public'
    );

    expect(hasPublicFilter).toBe(false);
  });
});
