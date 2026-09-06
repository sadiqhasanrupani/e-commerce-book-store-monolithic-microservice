import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Book } from '@app/contract/books/entities/book.entity';
import { RedisService } from '@app/redis';
import { DataSource, Repository } from 'typeorm';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { CartMetricsService } from '../metrics/cart-metrics.service';
import { ShippingRateService } from './shipping-rate.service';
import { TaxService } from './tax.service';

describe('CartService', () => {
  let service: CartService;
  let cartRepository: jest.Mocked<Repository<Cart>>;
  let cartItemRepository: jest.Mocked<Repository<CartItem>>;
  let variantRepository: jest.Mocked<Repository<BookFormatVariant>>;
  let bookRepository: jest.Mocked<Repository<Book>>;
  let redisService: jest.Mocked<RedisService>;
  let dataSource: jest.Mocked<DataSource>;
  let queryRunnerMock: any;
  let managerQb: any;
  let shippingRateService: { resolveShippingCost: jest.Mock; cartHasPhysicalItems: jest.Mock };

  const mockCart = {
    id: '123',
    userId: 1,
    status: CartStatus.ACTIVE,
    items: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockVariant = {
    id: 1,
    bookId: 'book-1',
    format: BookFormat.EBOOK,
    price: 19.99,
    stockQuantity: 100,
    reservedQuantity: 0,
    isAvailable: true,
  };

  const mockBook = {
    id: 'book-1',
    title: 'Test Book',
    visibility: 'public',
  };

  beforeEach(async () => {
    const mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      // Fully chainable: the service chains leftJoinAndSelect/where/andWhere/
      // orderBy before awaiting getOne. Stubbing only a subset makes the chain
      // return undefined mid-way and throws a misleading TypeError.
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        for (const method of [
          'leftJoin',
          'leftJoinAndSelect',
          'innerJoin',
          'innerJoinAndSelect',
          'select',
          'addSelect',
          'where',
          'andWhere',
          'orWhere',
          'orderBy',
          'addOrderBy',
          'skip',
          'take',
          'limit',
          'offset',
          'setLock',
        ]) {
          qb[method] = jest.fn(() => qb);
        }
        qb.getOne = jest.fn();
        qb.getMany = jest.fn(() => Promise.resolve([]));
        qb.getManyAndCount = jest.fn(() => Promise.resolve([[], 0]));
        qb.getCount = jest.fn(() => Promise.resolve(0));
        return qb;
      }),
    };

    managerQb = {};
    for (const method of [
      'innerJoinAndSelect',
      'leftJoinAndSelect',
      'setLock',
      'where',
      'andWhere',
      'update',
      'set',
      'setParameters',
    ]) {
      managerQb[method] = jest.fn(() => managerQb);
    }
    managerQb.getOne = jest.fn();
    managerQb.execute = jest.fn(() => Promise.resolve({ affected: 1 }));

    queryRunnerMock = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      isTransactionActive: true,
      isReleased: false,
      manager: {
        create: jest.fn((_entity: any, plain: any) => ({ ...plain })),
        findOne: jest.fn(),
        save: jest.fn((_entity: any, value: any) => Promise.resolve(value)),
        update: jest.fn(),
        remove: jest.fn(),
        // The service locks the variant row with
        // `.createQueryBuilder(BookFormatVariant, 'variant').setLock(...)` and
        // does the reservation arithmetic with the no-arg
        // `.createQueryBuilder().update()...execute()` form. One chainable
        // double serves both shapes; tests drive `managerQb.getOne`.
        createQueryBuilder: jest.fn(() => managerQb),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: getRepositoryToken(Cart),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(CartItem),
          useValue: { ...mockRepository },
        },
        {
          provide: getRepositoryToken(BookFormatVariant),
          useValue: { ...mockRepository },
        },
        {
          provide: getRepositoryToken(Book),
          useValue: { ...mockRepository },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          // CartService takes CartMetricsService as a constructor dependency;
          // without it the testing module fails to resolve and every test in
          // this file errors before it runs. Metrics are fire-and-forget, so a
          // no-op double is enough — nothing here asserts on them.
          provide: CartMetricsService,
          useValue: {
            incrementCartOperation: jest.fn(),
            updateCartItemsCount: jest.fn(),
            incrementCheckoutRequest: jest.fn(),
            observeCheckoutDuration: jest.fn(),
            incrementPaymentWebhook: jest.fn(),
            incrementStockReservation: jest.fn(),
            incrementCacheOperation: jest.fn(),
          },
        },
        {
          // Same story as CartMetricsService above: CartService now resolves the
          // cart summary's shipping line through ShippingRateService, so the
          // testing module cannot construct it without a double. Returns 0,
          // which is the shipped default (`SHIPPING_FLAT_RATE_PAISE` unset) and
          // keeps every pre-existing total assertion in this file valid.
          provide: ShippingRateService,
          useValue: {
            resolveShippingCost: jest.fn(() => 0),
            cartHasPhysicalItems: jest.fn(() => false),
          },
        },
        // Real, not a double: TaxService is a dependency-free calculator, so
        // stubbing it would only let this spec drift from the real formula.
        TaxService,
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(),
            // CartService does its writes through queryRunner.manager. The double
            // must cover every method the service actually calls (create,
            // findOne, save, update, remove) — a missing one surfaces as a
            // confusing "x is not a function" TypeError inside the service's
            // own try/catch, which then reports as the wrong exception type.
            createQueryRunner: jest.fn(() => queryRunnerMock),
          },
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
    cartRepository = module.get(getRepositoryToken(Cart));
    cartItemRepository = module.get(getRepositoryToken(CartItem));
    variantRepository = module.get(getRepositoryToken(BookFormatVariant));
    bookRepository = module.get(getRepositoryToken(Book));
    redisService = module.get(RedisService);
    dataSource = module.get(DataSource);
    shippingRateService = module.get(ShippingRateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * `getCart` no longer reads through Redis. The authenticated cart is now
   * loaded with a single `cartRepository.createQueryBuilder(...).getOne()`;
   * Redis survives in this service only for stock reservations and the guest
   * cart. Tests that asserted `redisService.get('cart:1')` were asserting
   * behaviour that has been deleted, so they are gone rather than "fixed".
   */
  describe('getCart', () => {
    const mockCartRead = (resolvedCart: any) => {
      const qb: any = {};
      qb.leftJoinAndSelect = jest.fn(() => qb);
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.orderBy = jest.fn(() => qb);
      qb.getOne = jest.fn().mockResolvedValue(resolvedCart);
      cartRepository.createQueryBuilder.mockReturnValueOnce(qb);
      return qb;
    };

    it('reads the cart from the database without consulting the cache', async () => {
      const qb = mockCartRead({ ...mockCart, items: [] });

      const result = await service.getCart(1);

      expect(qb.getOne).toHaveBeenCalled();
      expect(redisService.get).not.toHaveBeenCalled();
      expect(result.cartId).toBe(mockCart.id);
      expect(result.items).toEqual([]);
    });

    it('creates an empty cart when the user has none', async () => {
      mockCartRead(null);
      cartRepository.create.mockReturnValue({ ...mockCart } as any);
      cartRepository.save.mockResolvedValue({ ...mockCart } as any);

      const result = await service.getCart(1);

      expect(cartRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, status: CartStatus.ACTIVE }),
      );
      expect(cartRepository.save).toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.subtotal).toBe(0);
    });

    it('drops items whose variant or book has been deleted', async () => {
      mockCartRead({
        ...mockCart,
        items: [
          { id: 'ok', unitPrice: 100, qty: 1, bookFormatVariantId: 1,
            bookFormatVariant: { format: BookFormat.EBOOK, book: { id: 'book-1' } } },
          { id: 'orphan-variant', unitPrice: 100, qty: 1, bookFormatVariant: null },
          { id: 'orphan-book', unitPrice: 100, qty: 1, bookFormatVariant: { format: BookFormat.EBOOK, book: null } },
        ],
      });

      const result = await service.getCart(1);

      expect(result.items).toHaveLength(1);
      expect(result.subtotal).toBe(100);
    });
  });

  /**
   * The bug this guards: `GET /cart` used to have no notion of shipping at
   * all, so the storefront summary always showed 0/"Free" for a physical
   * basket while `CheckoutService` (correctly) charged the flat rate — a
   * customer sees one number pre-payment and their card is debited another.
   * The fix routes `getCart` through the SAME `ShippingRateService` calls
   * `CheckoutService` makes, so the pre-payment quote and the actual charge
   * cannot drift apart. See `checkout.service.spec.ts` ("flat-rate shipping")
   * for the charge-side half of this contract.
   */
  describe('getCart — shipping quote', () => {
    /**
     * `getCart` reads through `cartRepository.createQueryBuilder(...).getOne()`,
     * not `.findOne()` — a fresh queryBuilder double per test, matching the
     * exact chain (`leftJoinAndSelect` x3, `where`, `andWhere`, `orderBy`) the
     * service calls before awaiting `getOne()`.
     */
    const mockCartQuery = (resolvedCart: any) => {
      const qb: any = {};
      qb.leftJoinAndSelect = jest.fn(() => qb);
      qb.where = jest.fn(() => qb);
      qb.andWhere = jest.fn(() => qb);
      qb.orderBy = jest.fn(() => qb);
      qb.getOne = jest.fn().mockResolvedValue(resolvedCart);
      cartRepository.createQueryBuilder.mockReturnValueOnce(qb);
    };

    it('includes the shipping charge for a cart holding a physical item, from the shared rate service', async () => {
      mockCartQuery({
        ...mockCart,
        items: [
          {
            id: 'item-1',
            unitPrice: 250,
            qty: 2,
            title: 'A Paperback',
            coverImageUrl: 'cover.jpg',
            bookFormatVariantId: 10,
            bookFormatVariant: { format: BookFormat.PAPERBACK, book: { id: 'book-1' } },
          },
        ],
      });
      shippingRateService.cartHasPhysicalItems.mockReturnValue(true);
      shippingRateService.resolveShippingCost.mockReturnValue(49);

      const result = await service.getCart(1);

      // Same predicate CheckoutService re-derives from its locked variant rows.
      expect(shippingRateService.cartHasPhysicalItems).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ bookFormatVariantId: 10 })]),
      );
      expect(shippingRateService.resolveShippingCost).toHaveBeenCalledWith(true);
      expect(result.subtotal).toBe(500);
      expect(result.shipping).toBe(49);
      expect(result.total).toBe(549);
    });

    it('quotes zero shipping for a digital-only cart', async () => {
      mockCartQuery({
        ...mockCart,
        items: [
          {
            id: 'item-2',
            unitPrice: 10,
            qty: 1,
            title: 'An Ebook',
            coverImageUrl: 'cover.jpg',
            bookFormatVariantId: 20,
            bookFormatVariant: { format: BookFormat.EBOOK, book: { id: 'book-2' } },
          },
        ],
      });
      shippingRateService.cartHasPhysicalItems.mockReturnValue(false);
      shippingRateService.resolveShippingCost.mockReturnValue(0);

      const result = await service.getCart(1);

      expect(result.shipping).toBe(0);
      expect(result.total).toBe(result.subtotal);
    });
  });

  /**
   * The write paths all run inside a transaction and go through
   * `queryRunner.manager`, not the injected repositories. The previous tests
   * mocked the repositories and used an older field vocabulary (`quantity`
   * for `qty`, `variant` for `bookFormatVariant`) and the wrong exception
   * type for an oversell, so they were asserting a service that no longer
   * exists.
   */
  const PHYSICAL_VARIANT = {
    id: 1,
    format: BookFormat.PAPERBACK,
    price: 250,
    stockQuantity: 10,
    reservedQuantity: 0,
    book: { id: 'book-1', title: 'A Paperback', coverImageUrl: 'cover.jpg' },
  };

  const DIGITAL_VARIANT = {
    id: 2,
    format: BookFormat.EBOOK,
    price: 99,
    stockQuantity: 0,
    reservedQuantity: 0,
    book: { id: 'book-2', title: 'An Ebook', coverImageUrl: 'cover.jpg' },
  };

  /** Route `manager.findOne` by entity, the way the service calls it. */
  const managerFindOne = (byEntity: { cart?: any; cartItem?: any }) => {
    queryRunnerMock.manager.findOne.mockImplementation((entity: any) => {
      if (entity === Cart) return Promise.resolve(byEntity.cart ?? null);
      if (entity === CartItem) return Promise.resolve(byEntity.cartItem ?? null);
      return Promise.resolve(null);
    });
  };

  /** `addToCart` finishes by returning `getCart`, which re-reads the cart. */
  const stubTrailingGetCart = () => {
    const qb: any = {};
    qb.leftJoinAndSelect = jest.fn(() => qb);
    qb.where = jest.fn(() => qb);
    qb.andWhere = jest.fn(() => qb);
    qb.orderBy = jest.fn(() => qb);
    qb.getOne = jest.fn().mockResolvedValue({ ...mockCart, items: [] });
    cartRepository.createQueryBuilder.mockReturnValue(qb);
  };

  describe('addToCart', () => {
    beforeEach(stubTrailingGetCart);

    it('creates the line and reserves stock for a physical variant', async () => {
      managerFindOne({ cart: mockCart, cartItem: null });
      managerQb.getOne.mockResolvedValue(PHYSICAL_VARIANT);

      await service.addToCart(1, { bookFormatVariantId: 1, qty: 2 } as any);

      expect(queryRunnerMock.manager.create).toHaveBeenCalledWith(
        CartItem,
        expect.objectContaining({ bookFormatVariantId: 1, qty: 2, unitPrice: 250 }),
      );
      // Reservation is applied through the update query builder, not a save().
      expect(managerQb.execute).toHaveBeenCalled();
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    });

    it('reserves nothing for a digital variant, even with zero stock', async () => {
      managerFindOne({ cart: mockCart, cartItem: null });
      managerQb.getOne.mockResolvedValue(DIGITAL_VARIANT);

      await service.addToCart(1, { bookFormatVariantId: 2, qty: 3 } as any);

      expect(managerQb.execute).not.toHaveBeenCalled();
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    });

    it('adds to the existing quantity when the line is already in the cart', async () => {
      const existing: any = { id: 'item-1', qty: 3 };
      managerFindOne({ cart: mockCart, cartItem: existing });
      managerQb.getOne.mockResolvedValue(PHYSICAL_VARIANT);

      await service.addToCart(1, { bookFormatVariantId: 1, qty: 2 } as any);

      expect(existing.qty).toBe(5);
      expect(queryRunnerMock.manager.save).toHaveBeenCalledWith(existing);
    });

    it('rejects an oversell with ConflictException and rolls back', async () => {
      managerFindOne({ cart: mockCart, cartItem: null });
      managerQb.getOne.mockResolvedValue({ ...PHYSICAL_VARIANT, stockQuantity: 1 });

      await expect(
        service.addToCart(1, { bookFormatVariantId: 1, qty: 200 } as any),
      ).rejects.toThrow(ConflictException);

      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.commitTransaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the variant does not exist', async () => {
      managerFindOne({ cart: mockCart, cartItem: null });
      managerQb.getOne.mockResolvedValue(null);

      await expect(
        service.addToCart(1, { bookFormatVariantId: 999, qty: 1 } as any),
      ).rejects.toThrow(NotFoundException);

      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });

    it('always releases the query runner, even when the transaction fails', async () => {
      managerFindOne({ cart: mockCart, cartItem: null });
      managerQb.getOne.mockResolvedValue(null);

      await expect(
        service.addToCart(1, { bookFormatVariantId: 999, qty: 1 } as any),
      ).rejects.toThrow();

      expect(queryRunnerMock.release).toHaveBeenCalled();
    });
  });

  describe('updateCartItem', () => {
    beforeEach(stubTrailingGetCart);

    it('rejects a quantity the remaining stock cannot cover', async () => {
      managerFindOne({
        cartItem: {
          id: 'item-1',
          qty: 3,
          bookFormatVariantId: 1,
          isStockReserved: false,
          cart: { userId: 1 },
        },
      });
      managerQb.getOne.mockResolvedValue(PHYSICAL_VARIANT);

      await expect(
        service.updateCartItem(1, 'item-1', { qty: 200 } as any),
      ).rejects.toThrow(ConflictException);

      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown line', async () => {
      managerFindOne({ cartItem: null });

      await expect(
        service.updateCartItem(1, 'missing', { qty: 1 } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("refuses to touch another user's cart line", async () => {
      managerFindOne({
        cartItem: { id: 'item-1', qty: 1, bookFormatVariantId: 1, cart: { userId: 999 } },
      });

      await expect(
        service.updateCartItem(1, 'item-1', { qty: 2 } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('removeFromCart', () => {
    it('releases the reservation and removes the line', async () => {
      const cartItem = {
        id: 'item-1',
        qty: 3,
        cartId: mockCart.id,
        bookFormatVariantId: 1,
        isStockReserved: true,
        bookFormatVariant: PHYSICAL_VARIANT,
        cart: { userId: 1 },
      };
      managerFindOne({ cartItem });

      await service.removeFromCart(1, 'item-1');

      expect(queryRunnerMock.manager.update).toHaveBeenCalledWith(
        BookFormatVariant,
        { id: PHYSICAL_VARIANT.id },
        expect.any(Object),
      );
      expect(redisService.del).toHaveBeenCalledWith(
        `cart_reservation:${mockCart.id}:1`,
      );
      expect(queryRunnerMock.manager.remove).toHaveBeenCalledWith(cartItem);
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    });

    it('removes a digital line without touching any reservation', async () => {
      const cartItem = {
        id: 'item-2',
        qty: 1,
        cartId: mockCart.id,
        bookFormatVariantId: 2,
        isStockReserved: false,
        bookFormatVariant: DIGITAL_VARIANT,
        cart: { userId: 1 },
      };
      managerFindOne({ cartItem });

      await service.removeFromCart(1, 'item-2');

      expect(queryRunnerMock.manager.update).not.toHaveBeenCalled();
      expect(queryRunnerMock.manager.remove).toHaveBeenCalledWith(cartItem);
    });

    it('throws NotFoundException for an unknown line', async () => {
      managerFindOne({ cartItem: null });

      await expect(service.removeFromCart(1, 'invalid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearCart', () => {
    it('releases every physical reservation and removes all lines', async () => {
      const items = [
        { id: '1', qty: 2, bookFormatVariantId: 1, isStockReserved: true,
          bookFormatVariant: PHYSICAL_VARIANT },
        { id: '2', qty: 3, bookFormatVariantId: 2, isStockReserved: false,
          bookFormatVariant: DIGITAL_VARIANT },
      ];
      managerFindOne({ cart: { ...mockCart, items } });

      await service.clearCart(1);

      // Only the physical, actually-reserved line gives stock back.
      expect(queryRunnerMock.manager.update).toHaveBeenCalledTimes(1);
      expect(redisService.del).toHaveBeenCalledWith(`cart_reservation:${mockCart.id}:1`);
      expect(queryRunnerMock.manager.remove).toHaveBeenCalledWith(items);
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    });

    it('is a no-op when the user has no active cart', async () => {
      managerFindOne({ cart: null });

      await service.clearCart(1);

      expect(queryRunnerMock.manager.remove).not.toHaveBeenCalled();
    });
  });
});
