
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PaymentWebhookController } from 'apps/magic-pages-api-gateway/src/cart/payment-webhook.controller';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { ConfigModule } from '@nestjs/config';
import { CartMetricsService } from 'apps/magic-pages-api-gateway/src/cart/metrics/cart-metrics.service';
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
import { PhonePeProvider } from 'apps/magic-pages-api-gateway/src/cart/providers/phonepe.provider';
import { RazorpayProvider } from 'apps/magic-pages-api-gateway/src/cart/providers/razorpay.provider';

const mockMetricsService = { incrementPaymentWebhook: jest.fn() };
const mockPhonePeProvider = { verifyWebhook: jest.fn().mockReturnValue({ isValid: true, transactionId: 'T1', status: 'SUCCESS' }) };
const mockRazorpayProvider = { verifyWebhook: jest.fn().mockReturnValue({ isValid: true, transactionId: 'T1', status: 'SUCCESS' }) };

describe('PaymentWebhook Integration (Postgres)', () => {
  let module: TestingModule;
  let controller: PaymentWebhookController;
  let dataSource: DataSource;
  let cartRepo: Repository<Cart>;
  let variantRepo: Repository<BookFormatVariant>;
  let transactionRepo: Repository<Transaction>;
  let orderRepo: Repository<Order>;
  let orderItemRepo: Repository<OrderItem>;
  let cartItemRepo: Repository<CartItem>;
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
          dropSchema: false, // Keep schema from previous test
        }),
        TypeOrmModule.forFeature([Cart, CartItem, Order, OrderItem, BookFormatVariant, Transaction, Book, User]),
      ],
      controllers: [PaymentWebhookController],
      providers: [
        { provide: CartMetricsService, useValue: mockMetricsService },
        { provide: PhonePeProvider, useValue: mockPhonePeProvider },
        { provide: RazorpayProvider, useValue: mockRazorpayProvider },
      ],
    }).compile();

    controller = module.get<PaymentWebhookController>(PaymentWebhookController);
    dataSource = module.get<DataSource>(DataSource);
    cartRepo = module.get(getRepositoryToken(Cart));
    variantRepo = module.get(getRepositoryToken(BookFormatVariant));
    transactionRepo = module.get(getRepositoryToken(Transaction));
    orderRepo = module.get(getRepositoryToken(Order));
    orderItemRepo = module.get(getRepositoryToken(OrderItem));
    cartItemRepo = module.get(getRepositoryToken(CartItem));
    userRepo = module.get(getRepositoryToken(User));
  });

  afterAll(async () => {
    await module.close();
  });

  afterEach(async () => {
    await dataSource.query('TRUNCATE TABLE "cart_items", "orders", "transactions", "carts", "book_format_varients", "users" CASCADE');
  });

  it('should commit transaction and deduct stock on SUCCESS', async () => {
    // 1. Setup Data: Order PENDING, Cart CHECKOUT, Stock 10, Reserved 1
    // Create User FIRST to get ID
    const user = await userRepo.save({ email: 'webhook_user1@test.com' } as any);

    const variant = await variantRepo.save({ stockQuantity: 10, reservedQuantity: 1, format: BookFormat.PHYSICAL, price: 100 } as any);
    const cart = await cartRepo.save({ userId: user.id, status: CartStatus.CHECKOUT } as any);
    await cartItemRepo.save({ cart, qty: 1, bookFormatVariant: variant, unitPrice: 100 } as any);

    const order = await orderRepo.save({
      user: user,
      payment_status: PaymentStatus.PENDING,
      total_amount: 100
    } as any);
    await orderItemRepo.save({ order, bookFormatVariant: variant, quantity: 1, unit_price: 100 } as any);

    const txn = await transactionRepo.save({
      order: order,
      status: TransactionStatus.PENDING,
      provider: PaymentProvider.PHONEPE,
      amount: 100,
      currency: 'INR'
    } as any);

    // 2. Execute Webhook
    mockPhonePeProvider.verifyWebhook.mockReturnValue({ isValid: true, transactionId: txn.id, status: 'SUCCESS' });
    const payload = { transactionId: txn.id, status: 'SUCCESS' };
    const req = { body: payload, rawBody: JSON.stringify(payload) };
    const headers = { 'x-verify': 'dummy-signature' };

    const result = await controller.handleWebhook(req as any, headers as any);

    // 3. Assert
    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });
    const updatedOrder = await orderRepo.findOne({ where: { id: order.id } });
    const updatedCart = await cartRepo.findOne({ where: { id: cart.id } });

    expect(updatedOrder!.payment_status).toBe(PaymentStatus.PAID);
    expect(updatedVariant!.stockQuantity).toBe(9); // Deducted (10 - 1)
    expect(updatedVariant!.reservedQuantity).toBe(0); // Released (1 - 1)
    expect(updatedCart!.status).toBe(CartStatus.COMPLETED);
  });

  it('should revert cart to ACTIVE and release reservation on FAILED (with Timestamp Touch)', async () => {
    // 1. Setup
    const user = await userRepo.save({ email: 'webhook_user2@test.com' } as any);

    const variant = await variantRepo.save({ stockQuantity: 10, reservedQuantity: 1, format: BookFormat.PHYSICAL, price: 100 } as any);
    const initialCart = await cartRepo.save({ userId: user.id, status: CartStatus.CHECKOUT } as any);
    await cartItemRepo.save({ cart: initialCart, qty: 1, bookFormatVariant: variant, unitPrice: 100 } as any);

    // Sleep to ensure timestamp difference
    await new Promise(r => setTimeout(r, 1000));

    const order = await orderRepo.save({
      user: user,
      payment_status: PaymentStatus.PENDING,
      total_amount: 100
    } as any);
    await orderItemRepo.save({ order, bookFormatVariant: variant, quantity: 1, unit_price: 100 } as any);

    const txn = await transactionRepo.save({
      order: order,
      status: TransactionStatus.PENDING,
      provider: PaymentProvider.PHONEPE,
      amount: 100,
      currency: 'INR'
    } as any);

    // 2. Execute FAILED Webhook
    mockPhonePeProvider.verifyWebhook.mockReturnValue({ isValid: true, transactionId: txn.id, status: 'FAILED' });
    const payload = { transactionId: txn.id, status: 'FAILED' };
    const req = { body: payload, rawBody: JSON.stringify(payload) };
    const headers = { 'x-verify': 'dummy' };

    await controller.handleWebhook(req as any, headers as any);

    // 3. Assert
    const updatedCart = await cartRepo.findOne({ where: { id: initialCart.id } });
    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });

    expect(updatedCart!.status).toBe(CartStatus.ACTIVE);
    expect(updatedVariant!.reservedQuantity).toBe(1); // STILL RESERVED (Released only on timeout)
    expect(updatedVariant!.stockQuantity).toBe(10);

    // CRITICAL: Timestamp check
    expect(updatedCart!.updatedAt.getTime()).toBeGreaterThan(initialCart.updatedAt.getTime());
  });

});
