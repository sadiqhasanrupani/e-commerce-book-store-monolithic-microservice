
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CheckoutService } from '../../../apps/magic-pages-api-gateway/src/cart/providers/checkout.service';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Transaction } from '@app/contract/orders/entities/transaction.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { ConfigModule } from '@nestjs/config';
import { PhonePeProvider } from '../../../apps/magic-pages-api-gateway/src/cart/providers/phonepe.provider';
import { RazorpayProvider } from '../../../apps/magic-pages-api-gateway/src/cart/providers/razorpay.provider';
import { CartMetricsService } from '../../../apps/magic-pages-api-gateway/src/cart/metrics/cart-metrics.service';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { Book } from '@app/contract/books/entities/book.entity';
import { Author } from '@app/contract/author/entities/author.entity';
import { Tag } from '@app/contract/books/entities/tags.entity';
import { Category } from '@app/contract/books/entities/categories.entity';
import { BookMetric } from '@app/contract/books/entities/book-metrics.entity';
import { AgeGroup } from '@app/contract/age-groups/entities/age-group.entity';
import { User } from '@app/contract/users/entities/user.entity';
import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';
import { Refund } from '@app/contract/orders/entities/refund.entity';

// Mock dependencies
const mockPhonePeProvider = { initiatePayment: jest.fn().mockResolvedValue({ transactionId: 'T1', paymentUrl: 'url' }) };
const mockRazorpayProvider = { initiatePayment: jest.fn().mockResolvedValue({ transactionId: 'T2', paymentUrl: 'url' }) };
const mockMetricsService = { incrementCheckoutRequest: jest.fn(), observeCheckoutDuration: jest.fn() };

describe('Checkout Integration (Postgres)', () => {
  let module: TestingModule;
  let service: CheckoutService;
  let dataSource: DataSource;
  let cartRepo: Repository<Cart>;
  let variantRepo: Repository<BookFormatVariant>;
  let cartItemRepo: Repository<CartItem>;
  let userRepo: Repository<User>;

  beforeAll(async () => {
    jest.setTimeout(30000); // Increase timeout for TypeORM init
    try {
      console.log('Starting Test Module Compilation...');
      module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot(),
          TypeOrmModule.forRoot({
            type: 'postgres',
            host: 'localhost',
            port: 5434, // Postgres Test Port
            username: 'test',
            password: 'test',
            database: 'magic-pages-test',
            entities: [Cart, CartItem, Order, OrderItem, BookFormatVariant, Transaction, Book, Author, Tag, Category, BookMetric, AgeGroup, User, OrderStatusLog, Refund],
            synchronize: true, // Auto-create schema
            dropSchema: true,  // Clean start
            logging: true, // Enable logging to see SQL or Metadata errors
          }),
          TypeOrmModule.forFeature([Cart, CartItem, Order, OrderItem, BookFormatVariant, Transaction, Book, User]),
        ],
        providers: [
          CheckoutService,
          { provide: PhonePeProvider, useValue: mockPhonePeProvider },
          { provide: RazorpayProvider, useValue: mockRazorpayProvider },
          { provide: CartMetricsService, useValue: mockMetricsService },
        ],
      }).compile();

      console.log('Module Compiled Successfully');
      service = module.get<CheckoutService>(CheckoutService);
      dataSource = module.get<DataSource>(DataSource);
      cartRepo = module.get(getRepositoryToken(Cart));
      variantRepo = module.get(getRepositoryToken(BookFormatVariant));
      cartItemRepo = module.get(getRepositoryToken(CartItem));
      userRepo = module.get(getRepositoryToken(User));
    } catch (e) {
      console.error('SERVER SETUP ERROR:', e);
      throw e;
    }
  });

  afterAll(async () => {
    await module.close();
  });

  afterEach(async () => {
    // Clean up tables
    await dataSource.query('TRUNCATE TABLE "cart_items", "orders", "transactions", "carts", "book_format_varients", "users" CASCADE');
  });

  it('should reserve stock but NOT deduct permanent stock (2-Phase Commit)', async () => {
    // 1. Setup Data
    const user1 = await userRepo.save({ email: 'user1@test.com' } as any);
    const user1Id = user1.id;
    const variant = await variantRepo.save({ stockQuantity: 10, reservedQuantity: 0, format: BookFormat.PHYSICAL, price: 100 } as any);
    const cart = await cartRepo.save({ userId: user1Id, status: CartStatus.ACTIVE } as any);
    await cartItemRepo.save({ cart: cart, bookFormatVariant: variant, qty: 1, unitPrice: 100, isStockReserved: false } as any);

    // 2. Execute
    const result = await service.checkout(user1Id, { paymentMethod: PaymentProvider.PHONEPE, shippingAddress: { phone: '1234567890' } as any });

    // 3. Assert
    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });
    const updatedCart = await cartRepo.findOne({ where: { id: cart.id } });

    expect(result).toBeDefined();
    expect(updatedVariant!.stockQuantity).toBe(10); // NOT Deducted
    expect(updatedVariant!.reservedQuantity).toBe(1); // Reserved
    expect(updatedCart!.status).toBe(CartStatus.CHECKOUT);
  });

  it('should handle idempotency correctly', async () => {
    // 1. Setup
    await userRepo.save({ id: 2, email: 'user2@test.com' } as any);
    const variant = await variantRepo.save({ stockQuantity: 10, reservedQuantity: 0, format: BookFormat.PHYSICAL, price: 100 } as any);
    const cart = await cartRepo.save({ userId: 2, status: CartStatus.ACTIVE } as any);
    await cartItemRepo.save({ cart, bookFormatVariant: variant, qty: 1, unitPrice: 100 } as any);
    const idempotencyKey = "unique-key-123";

    // 2. First Call
    const res1 = await service.checkout(2, { paymentMethod: PaymentProvider.PHONEPE, shippingAddress: { phone: '123' } as any }, idempotencyKey);

    // 3. Second Call (Replay)
    const res2 = await service.checkout(2, { paymentMethod: PaymentProvider.PHONEPE, shippingAddress: { phone: '123' } as any }, idempotencyKey);

    // 4. Assert
    expect(res1).toEqual(res2);
    expect(mockPhonePeProvider.initiatePayment).toHaveBeenCalledTimes(1); // Provider called only ONCE
  });

  it('should prevent overselling when 2 users try to reserve simultaneously', async () => {
    // 1. Setup: 1 Item left
    // Create Users 3, 4 (Mock FKs)
    const user3 = await userRepo.save({ email: 'user3@test.com' } as any);
    const user3Id = user3.id;
    const user4 = await userRepo.save({ email: 'user4@test.com' } as any);
    const user4Id = user4.id;

    // Create a book variant
    const variant = await variantRepo.save({ stockQuantity: 1, reservedQuantity: 0, format: BookFormat.PHYSICAL, price: 100 } as any);

    // User A
    const cartA = await cartRepo.save({ userId: user3Id, status: CartStatus.ACTIVE } as any);
    await cartItemRepo.save({ cart: cartA, bookFormatVariant: variant, qty: 1, unitPrice: 100, isStockReserved: false } as any);

    // User B
    const cartB = await cartRepo.save({ userId: user4Id, status: CartStatus.ACTIVE } as any);
    await cartItemRepo.save({ cart: cartB, bookFormatVariant: variant, qty: 1, unitPrice: 100, isStockReserved: false } as any);

    // 2. Race Condition Simulation
    const results = await Promise.allSettled([
      service.checkout(3, { paymentMethod: PaymentProvider.PHONEPE, shippingAddress: { phone: '111' } as any }),
      service.checkout(4, { paymentMethod: PaymentProvider.PHONEPE, shippingAddress: { phone: '222' } as any })
    ]);

    // 3. Assert
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failCount = results.filter(r => r.status === 'rejected').length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });
    expect(updatedVariant!.reservedQuantity).toBe(1); // Should not be 2
  });

});
