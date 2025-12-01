import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CartService } from './providers/cart.service';
import { CheckoutService } from './providers/checkout.service';
import { ReservationWorkerService } from './providers/reservation-worker.service';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Book } from '@app/contract/books/entities/book.entity';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { RedisService } from '@app/redis';
import { CartMetricsService } from './metrics/cart-metrics.service';

describe('Cart Persistence & Soft Reservation (Mocked Integration)', () => {
  let cartService: CartService;
  let checkoutService: CheckoutService;
  let workerService: ReservationWorkerService;

  // Mock Data Store
  let carts: Cart[] = [];
  let cartItems: CartItem[] = [];
  let variants: BookFormatVariant[] = [];
  let orders: Order[] = [];

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      delete: jest.fn(),
      decrement: jest.fn(),
      increment: jest.fn(),
      query: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      }),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockPaymentProvider = {
    initiatePayment: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
  };

  const mockMetricsService = {
    incrementCheckoutRequest: jest.fn(),
    observeCheckoutDuration: jest.fn(),
  };

  let moduleFixture: TestingModule;

  beforeEach(async () => {
    // Reset Data
    carts = [];
    cartItems = [];
    variants = [];
    orders = [];

    moduleFixture = await Test.createTestingModule({
      providers: [
        CartService,
        CheckoutService,
        ReservationWorkerService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: RedisService, useValue: mockRedisService },
        { provide: 'PAYMENT_PROVIDER', useValue: mockPaymentProvider },
        { provide: CartMetricsService, useValue: mockMetricsService },
        { provide: getRepositoryToken(Cart), useValue: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(CartItem), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(BookFormatVariant), useValue: {} },
        { provide: getRepositoryToken(Book), useValue: {} },
        { provide: getRepositoryToken(Order), useValue: {} },
        { provide: getRepositoryToken(OrderItem), useValue: {} },
      ],
    }).compile();

    cartService = moduleFixture.get<CartService>(CartService);
    checkoutService = moduleFixture.get<CheckoutService>(CheckoutService);
    workerService = moduleFixture.get<ReservationWorkerService>(ReservationWorkerService);
  });

  it('should handle soft reservation lifecycle', async () => {
    // 1. Setup Data
    const variant = {
      id: 1,
      format: BookFormat.HARDCOVER,
      price: 100,
      stockQuantity: 10,
      reservedQuantity: 0,
      book: { title: 'Test Book' },
    } as any;
    variants.push(variant);

    const cart = {
      id: 'cart-1',
      userId: 999,
      status: CartStatus.ACTIVE,
      items: [],
      updatedAt: new Date(),
    } as any;
    carts.push(cart);

    // Mock QueryRunner Implementation to use local arrays
    mockQueryRunner.manager.findOne.mockImplementation((entity, options) => {
      if (entity === Cart) return carts.find(c => c.userId === options.where.userId);
      if (entity === CartItem) return cartItems.find(i => i.id === options.where.id);
      return null;
    });

    // Mock Cart Repository for getCart call at end of addToCart
    jest.spyOn(moduleFixture.get(getRepositoryToken(Cart)), 'findOne').mockImplementation(async () => {
      // Return cart with items
      return { ...cart, items: cartItems } as any;
    });

    mockQueryRunner.manager.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(variant),
    });

    mockQueryRunner.manager.create.mockImplementation((entity, data) => data);

    mockQueryRunner.manager.save.mockImplementation((arg1, arg2) => {
      let entity = arg2 || arg1;
      if (entity.bookFormatVariantId) { // CartItem
        const existing = cartItems.find(i => i.bookFormatVariantId === entity.bookFormatVariantId);
        if (existing) Object.assign(existing, entity);
        else {
          entity.id = 'item-1';
          entity.isStockReserved = true; // Default
          cartItems.push(entity);
          cart.items.push(entity);
        }
      } else if (entity instanceof Order) {
        entity.id = 1;
        orders.push(entity);
      }
      return entity;
    });

    mockQueryRunner.manager.update.mockImplementation((entity, criteria, data) => {
      if (entity === BookFormatVariant) {
        // Mock update logic for reservedQuantity
        // We can't easily parse the function () => ... string here in mock
        // So we manually update the variant in our test verification steps
      }
    });

    // 2. Add to Cart
    await cartService.addToCart(999, { bookFormatVariantId: 1, qty: 2 });

    // Verify item created
    expect(cartItems.length).toBe(1);
    expect(cartItems[0].qty).toBe(2);
    expect(cartItems[0].isStockReserved).toBe(true);

    // 3. Simulate Expiry & Worker
    // Mock worker repository calls
    const repoFind = jest.spyOn(moduleFixture.get(getRepositoryToken(Cart)), 'find').mockResolvedValue([]);
    const repoQueryBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([cartItems[0]]), // Return our item as expired
    };
    jest.spyOn(moduleFixture.get(getRepositoryToken(CartItem)), 'createQueryBuilder').mockReturnValue(repoQueryBuilder as any);

    // Manually set item to be "expired" for the test logic if needed, but we force return it
    cartItems[0].cart = cart;
    cartItems[0].bookFormatVariant = variant;

    await workerService.processCompletedCarts();

    // Verify update called to release reservation
    expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
      BookFormatVariant,
      { id: 1 },
      expect.objectContaining({ reservedQuantity: expect.any(Function) })
    );
    expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
      CartItem,
      { id: 'item-1' },
      { isStockReserved: false }
    );

    // Manually flip flag for next step
    cartItems[0].isStockReserved = false;

    // 4. Checkout (JIT)
    mockQueryRunner.manager.findOne.mockImplementation((entity, options) => {
      if (entity === Cart) return cart;
      if (entity === BookFormatVariant) return variant;
      return null;
    });

    await checkoutService.checkout(999, {
      paymentMethod: 'PHONEPE' as any,
      shippingAddress: { line1: 'Test', city: 'Test', state: 'TS', pincode: '123', phone: '123' },
    });

    // Verify JIT increment
    expect(mockQueryRunner.manager.increment).toHaveBeenCalledWith(
      BookFormatVariant,
      { id: 1 },
      'reservedQuantity',
      2
    );

    // Verify Final Decrement
    expect(mockQueryRunner.manager.decrement).toHaveBeenCalledWith(
      BookFormatVariant,
      { id: 1 },
      'stockQuantity',
      2
    );
  });
});
