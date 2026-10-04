import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaymentReconciliationService } from 'apps/magic-pages-api-gateway/src/cart/services/payment-reconciliation.service';
import { PaymentSettlementService, SettlementOutcome } from 'apps/magic-pages-api-gateway/src/cart/services/payment-settlement.service';
import { RazorpayProvider } from 'apps/magic-pages-api-gateway/src/cart/providers/razorpay.provider';
import { PaymentStatus as ProviderPaymentStatus } from 'apps/magic-pages-api-gateway/src/cart/interfaces/payment-provider.interface';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
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
import { DigitalDeliveryService } from 'apps/magic-pages-api-gateway/src/digital-delivery/providers/digital-delivery.service';
import { DigitalDeliveryStatus } from '@app/contract/orders/enums/digital-delivery-status.enum';
import { MailService } from 'apps/magic-pages-api-gateway/src/mail/mail.service';

/**
 * The reconciliation cron is the fallback for a Razorpay webhook that never
 * arrived. These tests exist because the previous implementation queried
 * PhonePe transactions (so it recovered nothing at all) and, even when it did
 * fire, only flipped status flags without deducting stock.
 */
const mockRazorpayProvider = { getPaymentStatus: jest.fn() };

/**
 * SMTP is the only thing stubbed out of the digital delivery path — the claim,
 * the status transitions and the exactly-once guarantee all run against real
 * Postgres, because that is where the guarantee actually lives (a conditional
 * UPDATE under a row lock).
 */
const mockMailService = { sendDigitalDeliveryEmail: jest.fn().mockResolvedValue(undefined) };

describe('Payment Reconciliation Integration (Postgres)', () => {
  let module: TestingModule;
  let service: PaymentReconciliationService;
  let settlementService: PaymentSettlementService;
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
          dropSchema: false,
        }),
        TypeOrmModule.forFeature([Cart, CartItem, Order, OrderItem, BookFormatVariant, Transaction, Book, User]),
      ],
      providers: [
        PaymentReconciliationService,
        PaymentSettlementService,
        // Settlement now also delivers digital material. The real service is
        // used (not a mock) so the digital assertions below exercise the actual
        // claim SQL against Postgres.
        DigitalDeliveryService,
        { provide: RazorpayProvider, useValue: mockRazorpayProvider },
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    service = module.get<PaymentReconciliationService>(PaymentReconciliationService);
    settlementService = module.get<PaymentSettlementService>(PaymentSettlementService);
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
    jest.clearAllMocks();
    await dataSource.query('TRUNCATE TABLE "cart_items", "orders", "transactions", "carts", "book_format_varients", "users" CASCADE');
  });

  /** Builds a paid-but-unacknowledged scenario: order PENDING, cart CHECKOUT, stock reserved. */
  async function seedPendingCheckout(
    email: string,
    opts: { ageMinutes: number; provider?: string; format?: BookFormat },
  ) {
    const user = await userRepo.save({ email } as any);
    const variant = await variantRepo.save({
      stockQuantity: 10,
      reservedQuantity: 1,
      format: opts.format ?? BookFormat.PHYSICAL,
      price: 100,
    } as any);
    const cart = await cartRepo.save({ userId: user.id, status: CartStatus.CHECKOUT } as any);
    await cartItemRepo.save({ cart, qty: 1, bookFormatVariant: variant, unitPrice: 100 } as any);
    const order = await orderRepo.save({ user, payment_status: PaymentStatus.PENDING, total_amount: 100 } as any);
    await orderItemRepo.save({ order, bookFormatVariant: variant, quantity: 1, unit_price: 100 } as any);
    const txn = await transactionRepo.save({
      order,
      status: TransactionStatus.PENDING,
      provider: opts.provider ?? PaymentProvider.RAZORPAY,
      gateway_ref_id: `order_RZP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      amount: 100,
      currency: 'INR',
    } as any);

    // created_at is set by @CreateDateColumn, so age it directly — the cron only
    // looks at transactions older than 5 minutes.
    await dataSource.query(`UPDATE "transactions" SET "created_at" = now() - interval '${opts.ageMinutes} minutes' WHERE "id" = $1`, [txn.id]);

    return { user, variant, cart, order, txn };
  }

  it('recovers a Razorpay payment whose webhook never arrived, including stock deduction', async () => {
    const { variant, cart, order, txn } = await seedPendingCheckout('recon_ok@test.com', { ageMinutes: 10 });

    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: txn.gateway_ref_id,
      status: ProviderPaymentStatus.SUCCESS,
      amount: 100,
    });

    await service.handleCron();

    expect(mockRazorpayProvider.getPaymentStatus).toHaveBeenCalledWith(txn.gateway_ref_id);

    const updatedTxn = await transactionRepo.findOne({ where: { id: txn.id } });
    const updatedOrder = await orderRepo.findOne({ where: { id: order.id } });
    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });
    const updatedCart = await cartRepo.findOne({ where: { id: cart.id } });

    expect(updatedTxn!.status).toBe(TransactionStatus.SUCCESS);
    expect(updatedOrder!.payment_status).toBe(PaymentStatus.PAID);
    // The old implementation never touched these two — that was the oversell.
    expect(updatedVariant!.stockQuantity).toBe(9);
    expect(updatedVariant!.reservedQuantity).toBe(0);
    expect(updatedCart!.status).toBe(CartStatus.COMPLETED);
  });

  it('is idempotent — a second run after the webhook lands does not double-deduct', async () => {
    const { variant, txn } = await seedPendingCheckout('recon_twice@test.com', { ageMinutes: 10 });

    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: txn.gateway_ref_id,
      status: ProviderPaymentStatus.SUCCESS,
      amount: 100,
    });

    await service.handleCron();
    await service.handleCron();

    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });
    expect(updatedVariant!.stockQuantity).toBe(9);
    expect(updatedVariant!.reservedQuantity).toBe(0);
  });

  it('ignores transactions younger than the 5 minute grace period', async () => {
    await seedPendingCheckout('recon_young@test.com', { ageMinutes: 1 });

    await service.handleCron();

    expect(mockRazorpayProvider.getPaymentStatus).not.toHaveBeenCalled();
  });

  it('ignores legacy PhonePe transactions', async () => {
    const { order } = await seedPendingCheckout('recon_legacy@test.com', { ageMinutes: 10, provider: 'phonepe' });

    await service.handleCron();

    expect(mockRazorpayProvider.getPaymentStatus).not.toHaveBeenCalled();
    const updatedOrder = await orderRepo.findOne({ where: { id: order.id } });
    expect(updatedOrder!.payment_status).toBe(PaymentStatus.PENDING);
  });

  it('does not touch stock counters for a digital format', async () => {
    // CheckoutService only reserves stock for physical formats, so settlement
    // must only release physical holds. Decrementing here would take off a hold
    // that was never placed and drive reservedQuantity negative — which reads as
    // extra availability, i.e. an oversell.
    const { variant, order, txn } = await seedPendingCheckout('recon_digital@test.com', {
      ageMinutes: 10,
      format: BookFormat.EBOOK,
    });

    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: txn.gateway_ref_id,
      status: ProviderPaymentStatus.SUCCESS,
      amount: 100,
    });

    await service.handleCron();

    const updatedOrder = await orderRepo.findOne({ where: { id: order.id } });
    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });

    // The payment still settles...
    expect(updatedOrder!.payment_status).toBe(PaymentStatus.PAID);
    // ...but the counters are left exactly as seeded.
    expect(updatedVariant!.stockQuantity).toBe(10);
    expect(updatedVariant!.reservedQuantity).toBe(1);

    // ...and the digital half of settlement runs instead: the buyer is emailed
    // their material and the line is recorded as delivered.
    expect(mockMailService.sendDigitalDeliveryEmail).toHaveBeenCalledTimes(1);

    const deliveredItem = await orderItemRepo.findOne({ where: { order: { id: order.id } } });
    expect(deliveredItem!.digital_delivery_status).toBe(DigitalDeliveryStatus.DELIVERED);
    expect(deliveredItem!.digital_delivered_at).toBeInstanceOf(Date);
  });

  /**
   * Exactly-once delivery, proven against real Postgres.
   *
   * The unit test covers this with an in-memory stand-in; this one exercises
   * the mechanism that actually enforces it — a conditional UPDATE on
   * `digital_delivery_status` issued while the order row is held under
   * `FOR UPDATE`. Reconciliation and a late webhook both settling the same
   * order is a routine event in production, and it must not mail the buyer
   * their ebook twice.
   */
  it('delivers digital material exactly once when reconciliation and the webhook both settle', async () => {
    const { order, txn } = await seedPendingCheckout('recon_digital_twice@test.com', {
      ageMinutes: 10,
      format: BookFormat.EBOOK,
    });

    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: txn.gateway_ref_id,
      status: ProviderPaymentStatus.SUCCESS,
      amount: 100,
    });

    // The cron gets there first...
    await service.handleCron();
    // ...and the webhook lands afterwards on the same transaction.
    const secondOutcome = await settlementService.settleSuccess(txn.id, { webhook: { event: 'payment.captured' } });

    expect(secondOutcome).toBe(SettlementOutcome.ALREADY_PROCESSED);
    expect(mockMailService.sendDigitalDeliveryEmail).toHaveBeenCalledTimes(1);

    const item = await orderItemRepo.findOne({ where: { order: { id: order.id } } });
    expect(item!.digital_delivery_status).toBe(DigitalDeliveryStatus.DELIVERED);
  });

  /** Physical lines must never pick up a digital delivery status. */
  it('leaves physical lines undelivered and unmailed', async () => {
    const { order, txn } = await seedPendingCheckout('recon_physical_delivery@test.com', {
      ageMinutes: 10,
      format: BookFormat.PAPERBACK,
    });

    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: txn.gateway_ref_id,
      status: ProviderPaymentStatus.SUCCESS,
      amount: 100,
    });

    await service.handleCron();

    expect(mockMailService.sendDigitalDeliveryEmail).not.toHaveBeenCalled();

    const item = await orderItemRepo.findOne({ where: { order: { id: order.id } } });
    expect(item!.digital_delivery_status).toBeNull();
    expect(item!.digital_delivered_at).toBeNull();
  });

  it('never lets a late failure downgrade an already-settled success', async () => {
    // Both settlement paths take the same pessimistic write lock on the order
    // row, so whichever arrives second re-reads the status under that lock and
    // backs off. Before the lock was added to settleFailure, a late
    // `payment.failed` could overwrite a genuinely paid transaction.
    const { variant, order, txn } = await seedPendingCheckout('recon_downgrade@test.com', { ageMinutes: 10 });

    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: txn.gateway_ref_id,
      status: ProviderPaymentStatus.SUCCESS,
      amount: 100,
    });

    await service.handleCron();

    // A stale FAILED notification lands afterwards.
    const outcome = await settlementService.settleFailure(txn.id, { webhook: { event: 'payment.failed' } });

    const finalTxn = await transactionRepo.findOne({ where: { id: txn.id } });
    const finalOrder = await orderRepo.findOne({ where: { id: order.id } });
    const finalVariant = await variantRepo.findOne({ where: { id: variant.id } });

    expect(outcome).toBe(SettlementOutcome.ALREADY_PROCESSED);
    expect(finalTxn!.status).toBe(TransactionStatus.SUCCESS);
    expect(finalOrder!.payment_status).toBe(PaymentStatus.PAID);
    // Stock stays deducted; the cart is not resurrected.
    expect(finalVariant!.stockQuantity).toBe(9);
    expect(finalVariant!.reservedQuantity).toBe(0);
  });

  it('leaves an unpaid transaction pending for the timeout job', async () => {
    const { order, txn, variant } = await seedPendingCheckout('recon_unpaid@test.com', { ageMinutes: 10 });

    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: txn.gateway_ref_id,
      status: ProviderPaymentStatus.PENDING,
      amount: 100,
    });

    await service.handleCron();

    const updatedTxn = await transactionRepo.findOne({ where: { id: txn.id } });
    const updatedOrder = await orderRepo.findOne({ where: { id: order.id } });
    const updatedVariant = await variantRepo.findOne({ where: { id: variant.id } });

    expect(updatedTxn!.status).toBe(TransactionStatus.PENDING);
    expect(updatedOrder!.payment_status).toBe(PaymentStatus.PENDING);
    expect(updatedVariant!.stockQuantity).toBe(10);
  });
});
