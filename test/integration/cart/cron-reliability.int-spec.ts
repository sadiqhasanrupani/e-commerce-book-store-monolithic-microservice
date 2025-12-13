
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ReservationCleanupService } from 'apps/magic-pages-api-gateway/src/cart/services/reservation-cleanup.service';
import { OrderTimeoutService } from 'apps/magic-pages-api-gateway/src/cart/services/order-timeout.service';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { ConfigModule } from '@nestjs/config';
import { Book } from '@app/contract/books/entities/book.entity';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { Author } from '@app/contract/author/entities/author.entity';
import { Tag } from '@app/contract/books/entities/tags.entity';
import { Category } from '@app/contract/books/entities/categories.entity';
import { BookMetric } from '@app/contract/books/entities/book-metrics.entity';
import { AgeGroup } from '@app/contract/age-groups/entities/age-group.entity';
import { User } from '@app/contract/users/entities/user.entity';
import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';
import { Refund } from '@app/contract/orders/entities/refund.entity';

describe('Cron Reliability Integration (Postgres)', () => {
  let module: TestingModule;
  let cleanupService: ReservationCleanupService;
  let timeoutService: OrderTimeoutService;
  let dataSource: DataSource;
  let cartRepo: Repository<Cart>;
  let variantRepo: Repository<BookFormatVariant>;
  let orderRepo: Repository<Order>;
  let cartItemRepo: Repository<CartItem>;
  let transactionRepo: Repository<Transaction>;
  let orderItemRepo: Repository<OrderItem>;
  let userRepo: Repository<User>;

  beforeAll(async () => {
    jest.setTimeout(30000);
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
          synchronize: true,
          dropSchema: false,
        }),
        TypeOrmModule.forFeature([Cart, CartItem, Order, OrderItem, BookFormatVariant, Transaction, Book, User]),
      ],
      providers: [ReservationCleanupService, OrderTimeoutService],
    }).compile();

    cleanupService = module.get<ReservationCleanupService>(ReservationCleanupService);
    timeoutService = module.get<OrderTimeoutService>(OrderTimeoutService);
    dataSource = module.get<DataSource>(DataSource);
    cartRepo = module.get(getRepositoryToken(Cart));
    variantRepo = module.get(getRepositoryToken(BookFormatVariant));
    orderRepo = module.get(getRepositoryToken(Order));
    cartItemRepo = module.get(getRepositoryToken(CartItem));
    transactionRepo = module.get(getRepositoryToken(Transaction));
    orderItemRepo = module.get(getRepositoryToken(OrderItem));
    userRepo = module.get(getRepositoryToken(User));
  });

  afterAll(async () => {
    await module.close();
  });

  afterEach(async () => {
    await dataSource.query('TRUNCATE TABLE "cart_items", "orders", "transactions", "carts", "book_format_varients", "users" CASCADE');
  });

  it('should cancel PENDING orders > 15m and release stock (OrderTimeoutService)', async () => {
    // 1. Setup: Order PENDING, Created 20m ago
    const [user, variant] = await Promise.all([
      userRepo.save({ email: 'user1@test.com' } as any),
      variantRepo.save({ stockQuantity: 10, reservedQuantity: 5, format: BookFormat.PHYSICAL, price: 100 } as any)
    ]);
    const oldDate = new Date(Date.now() - 20 * 60 * 1000);

    const order = await orderRepo.save({
      user: { id: user.id } as unknown as User,
      payment_status: PaymentStatus.PENDING,
      total_amount: 100,
      created_at: oldDate, // Manual Override
    } as any);
    await orderItemRepo.save({ order, bookFormatVariant: variant, quantity: 2, unit_price: 100 } as any);

    // We need to manually update created_at via query because TypeORM might overwrite it on save if not careful, 
    // but 'save' usually respects generic objects. Let's force it to be sure.
    await orderRepo.update(order.id, { created_at: oldDate });

    // 2. Execute
    await timeoutService.cancelPendingOrders();

    // 3. Assert
    const updatedOrder = await orderRepo.findOne({ where: { id: order.id } });
    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });

    expect(updatedOrder!.payment_status).toBe(PaymentStatus.FAILED);
    expect(updatedVariant!.reservedQuantity).toBe(3); // 5 - 2 = 3 (Released)
    expect(updatedVariant!.stockQuantity).toBe(10); // Unchanged
  });

  it('should release stock for ACTIVE carts > 15m (ReservationCleanupService)', async () => {
    // 1. Setup: Cart ACTIVE, Updated 20m ago, reserved=true
    await userRepo.save({ id: 2, email: 'user2@test.com' } as any);
    const variant = await variantRepo.save({ stockQuantity: 10, reservedQuantity: 5, format: BookFormat.PHYSICAL, price: 100 } as any);
    const oldDate = new Date(Date.now() - 20 * 60 * 1000);

    // Save Cart first
    const cart = await cartRepo.save({ userId: 2, status: CartStatus.ACTIVE } as any);
    // Force update updatedAt
    await cartRepo.update(cart.id, { updatedAt: oldDate });

    // Create Item associated with cart
    const item = await cartItemRepo.save({
      cart: cart,
      bookFormatVariant: variant,
      qty: 2,
      unitPrice: 100,
      isStockReserved: true,
      updatedAt: oldDate // Force update
    } as any);
    // Manually update item timestamp and cart timestamp to be sure
    await cartItemRepo.update(item.id, { updatedAt: oldDate });


    // 2. Execute
    await cleanupService.cleanupStaleReservations();

    // 3. Assert
    const updatedItem = await cartItemRepo.findOne({ where: { id: item.id } });
    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });

    expect(updatedItem!.isStockReserved).toBe(false);
    expect(updatedVariant!.reservedQuantity).toBe(3); // 5 - 2 = 3
  });

  it('should IGNORE carts in CHECKOUT status even if old (Race Condition)', async () => {
    // 1. Setup: Cart CHECKOUT, Updated 20m ago (User holding page open? or just stuck)
    await userRepo.save({ id: 3, email: 'user3@test.com' } as any);
    const variant = await variantRepo.save({ stockQuantity: 10, reservedQuantity: 5, format: BookFormat.PHYSICAL, price: 100 } as any);
    const oldDate = new Date(Date.now() - 20 * 60 * 1000);

    const cart = await cartRepo.save({ userId: 3, status: CartStatus.CHECKOUT } as any);
    await cartRepo.update(cart.id, { updatedAt: oldDate });

    const item = await cartItemRepo.save({
      cart: cart,
      bookFormatVariant: variant,
      qty: 2,
      unitPrice: 100,
      isStockReserved: true
    } as any);
    await cartItemRepo.update(item.id, { updatedAt: oldDate });


    // 2. Execute Reservation Cleanup (Should only touch ACTIVE carts)
    await cleanupService.cleanupStaleReservations();

    // 3. Assert
    const updatedItem = await cartItemRepo.findOne({ where: { id: item.id } });
    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });

    // Should REMAIN RESERVED because it's in CHECKOUT. 
    // OrderTimeoutService handles CHECKOUT carts (via Order creation) or if we want another cron.
    // But ReservationCleanupService specifically targets ACTIVE carts.
    expect(updatedItem!.isStockReserved).toBe(true);
    expect(updatedVariant!.reservedQuantity).toBe(5); // Unchanged
  });
});
