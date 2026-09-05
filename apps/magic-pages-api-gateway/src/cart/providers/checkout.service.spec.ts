import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutService } from './checkout.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Transaction } from '@app/contract/orders/entities/transaction.entity';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { CheckoutDto } from '@app/contract/carts/dtos/checkout.dto';
import { CartErrorCode } from '@app/contract/carts/enums/cart-error-code.enum';
import { RazorpayProvider } from './razorpay.provider';
import { ShippingRateService } from './shipping-rate.service';
import { CartMetricsService } from '../metrics/cart-metrics.service';

describe('CheckoutService', () => {
  let service: CheckoutService;

  /**
   * Flat shipping rate the fake config reports, in paise. Reassigned per test:
   * the default deployment charges nothing, but the money-path assertions below
   * need a non-zero rate to prove it reaches the order, the transaction and the
   * gateway together.
   */
  let flatRatePaise = 0;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    isTransactionActive: true,
    isReleased: false,
    manager: {
      findOne: jest.fn(),
      save: jest.fn(),
      increment: jest.fn(),
      decrement: jest.fn(),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  // Razorpay is the only gateway CheckoutService knows about since PhonePe was
  // dropped (roadmap #6); this mock stands in for the real provider class token.
  const mockRazorpayProvider = {
    initiatePayment: jest.fn(),
  };

  const mockTransactionRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((txn) => Promise.resolve({ id: 'txn-uuid-1', ...txn })),
  };

  const mockMetricsService = {
    incrementCheckoutRequest: jest.fn(),
    observeCheckoutDuration: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    flatRatePaise = 0;
    mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
    mockTransactionRepository.findOne.mockResolvedValue(null);
    mockTransactionRepository.save.mockImplementation((txn) => Promise.resolve({ id: 'txn-uuid-1', ...txn }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: getRepositoryToken(Cart), useValue: {} },
        { provide: getRepositoryToken(Order), useValue: {} },
        { provide: getRepositoryToken(OrderItem), useValue: {} },
        { provide: getRepositoryToken(BookFormatVariant), useValue: {} },
        { provide: getRepositoryToken(Transaction), useValue: mockTransactionRepository },
        { provide: DataSource, useValue: mockDataSource },
        { provide: RazorpayProvider, useValue: mockRazorpayProvider },
        { provide: CartMetricsService, useValue: mockMetricsService },
        // Real ShippingRateService over a fake config: the unit under test here
        // is "does the flat rate reach the money", so stubbing the service away
        // would assert nothing.
        ShippingRateService,
        { provide: ConfigService, useValue: { get: () => flatRatePaise } },
      ],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkout', () => {
    it('should successfully checkout a cart', async () => {
      const userId = 1;
      // NOTE: this literal previously omitted the customer fields that
      // CheckoutDto requires, so the whole suite failed to compile. Uses the
      // deprecated `pincode` alias deliberately — it is what the currently
      // deployed storefront build sends.
      const dto: CheckoutDto = {
        firstName: 'Ayaan',
        lastName: 'Khan',
        email: 'ayaan@example.com',
        saveInfo: false,
        paymentMethod: PaymentProvider.RAZORPAY,
        shippingAddress: {
          line1: '123 St',
          city: 'City',
          state: 'State',
          pincode: '123456',
          phone: '1234567890',
        },
      };

      const mockCart = {
        id: 1,
        userId,
        status: CartStatus.ACTIVE,
        items: [
          {
            id: 1,
            qty: 1,
            unitPrice: 100,
            isStockReserved: true,
            bookFormatVariant: {
              id: 1,
              format: BookFormat.PHYSICAL,
              stockQuantity: 10,
              reservedQuantity: 1,
            },
          },
        ],
      };

      mockQueryRunner.manager.findOne.mockImplementation((entity) => {
        if (entity === Cart) return Promise.resolve(mockCart);
        if (entity === BookFormatVariant) return Promise.resolve(mockCart.items[0].bookFormatVariant);
        return Promise.resolve(null);
      });

      mockQueryRunner.manager.save.mockImplementation((entity, data) => {
        if (entity === Order) return Promise.resolve({ ...data, id: 101 });
        return Promise.resolve(data);
      });

      mockRazorpayProvider.initiatePayment.mockResolvedValue({
        transactionId: 'order_TXN123',
        orderId: 'order_TXN123',
        provider: PaymentProvider.RAZORPAY,
      });

      const result = await service.checkout(userId, dto);

      expect(result).toBeDefined();
      expect(result.transactionId).toBe('order_TXN123');
      expect(mockRazorpayProvider.initiatePayment).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      // Stock is NOT deducted at checkout — the reservation is held until the
      // payment result lands (PaymentSettlementService).
      expect(mockQueryRunner.manager.decrement).not.toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      mockQueryRunner.manager.findOne.mockRejectedValue(new Error('DB Error'));

      await expect(service.checkout(1, {} as any)).rejects.toThrow('DB Error');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  /**
   * Flat-rate shipping.
   *
   * The failure mode being guarded is not "we forgot to add shipping" — it is
   * the subtler one where shipping lands on the order but not on the
   * transaction or the gateway call, so the customer is billed one number while
   * the books say another. Every test below therefore asserts all three
   * together.
   */
  describe('flat-rate shipping', () => {
    const dto: CheckoutDto = {
      firstName: 'Ayaan',
      lastName: 'Khan',
      email: 'ayaan@example.com',
      saveInfo: false,
      paymentMethod: PaymentProvider.RAZORPAY,
      shippingAddress: {
        line1: '123 St',
        city: 'City',
        state: 'State',
        pincode: '123456',
        phone: '1234567890',
      },
    };

    /** Wire up a one-line cart of the given format, priced at 100 major units. */
    const arrangeCart = (format: BookFormat) => {
      const variant = { id: 1, format, stockQuantity: 10, reservedQuantity: 1 };
      const cart = {
        id: 1,
        userId: 1,
        status: CartStatus.ACTIVE,
        items: [{ id: 1, qty: 1, unitPrice: 100, isStockReserved: true, bookFormatVariant: variant }],
      };

      mockQueryRunner.manager.findOne.mockImplementation((entity) => {
        if (entity === Cart) return Promise.resolve(cart);
        if (entity === BookFormatVariant) return Promise.resolve(variant);
        return Promise.resolve(null);
      });

      const savedOrders: any[] = [];
      mockQueryRunner.manager.save.mockImplementation((entity, data) => {
        if (entity === Order) {
          savedOrders.push(data);
          return Promise.resolve({ ...data, id: 101 });
        }
        return Promise.resolve(data);
      });

      mockRazorpayProvider.initiatePayment.mockResolvedValue({
        transactionId: 'order_TXN123',
        orderId: 'order_TXN123',
        provider: PaymentProvider.RAZORPAY,
      });

      return savedOrders;
    };

    it('charges the flat rate once on a physical order and folds it into every amount', async () => {
      flatRatePaise = 4900; // ₹49
      const savedOrders = arrangeCart(BookFormat.PHYSICAL);

      await service.checkout(1, dto);

      // 100 (line total) + 49 (shipping) = 149, in major units.
      expect(savedOrders[0].total_amount).toBe(149);
      expect(savedOrders[0].shipping_cost).toBe(49);
      // The transaction row and the gateway must agree with the order, or the
      // customer is charged a different number from the one we recorded.
      expect(mockTransactionRepository.save).toHaveBeenCalledWith(expect.objectContaining({ amount: 149 }));
      expect(mockRazorpayProvider.initiatePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 149 }));
    });

    it('charges no shipping on a digital-only order', async () => {
      flatRatePaise = 4900;
      const savedOrders = arrangeCart(BookFormat.EBOOK);

      await service.checkout(1, dto);

      expect(savedOrders[0].total_amount).toBe(100);
      expect(savedOrders[0].shipping_cost).toBe(0);
      expect(mockRazorpayProvider.initiatePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }));
    });

    /**
     * The shipped default. `SHIPPING_FLAT_RATE_PAISE` is unset until the
     * business supplies a number, and until then checkout must behave exactly
     * as it did before this feature existed.
     */
    it('charges nothing when no rate is configured', async () => {
      flatRatePaise = 0;
      const savedOrders = arrangeCart(BookFormat.PHYSICAL);

      await service.checkout(1, dto);

      expect(savedOrders[0].total_amount).toBe(100);
      expect(savedOrders[0].shipping_cost).toBe(0);
    });
  });

  /**
   * `CheckoutDto.shippingAddress` is optional at the DTO layer (a digital-only
   * order needs none), so nothing there can enforce "a physical order needs an
   * address" — it has no way to know what is in the cart. This is the one
   * place that can: `hasPhysicalItems` here comes from the same locked variant
   * rows the stock and shipping-cost decisions use. Without this guard a
   * paperback could reach PAID with `shipping_address` permanently NULL, with
   * nothing downstream to catch it before an admin tries to ship it nowhere.
   */
  describe('shipping address requirement', () => {
    const dtoWithoutAddress: CheckoutDto = {
      firstName: 'Ayaan',
      lastName: 'Khan',
      email: 'ayaan@example.com',
      saveInfo: false,
      paymentMethod: PaymentProvider.RAZORPAY,
      // shippingAddress omitted — the DTO allows this unconditionally.
    };

    const arrangeCartFormat = (format: BookFormat) => {
      const variant = { id: 1, format, stockQuantity: 10, reservedQuantity: 1 };
      const cart = {
        id: 1,
        userId: 1,
        status: CartStatus.ACTIVE,
        items: [{ id: 1, qty: 1, unitPrice: 100, isStockReserved: true, bookFormatVariant: variant }],
      };

      mockQueryRunner.manager.findOne.mockImplementation((entity) => {
        if (entity === Cart) return Promise.resolve(cart);
        if (entity === BookFormatVariant) return Promise.resolve(variant);
        return Promise.resolve(null);
      });
    };

    it('rejects checkout with no shippingAddress when the cart holds a physical item', async () => {
      arrangeCartFormat(BookFormat.PHYSICAL);

      await expect(service.checkout(1, dtoWithoutAddress)).rejects.toMatchObject({
        response: { code: CartErrorCode.SHIPPING_ADDRESS_REQUIRED },
      });

      // Refused before any order was written or any charge initiated.
      expect(mockQueryRunner.manager.save).not.toHaveBeenCalledWith(Order, expect.anything());
      expect(mockRazorpayProvider.initiatePayment).not.toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('allows checkout with no shippingAddress for a digital-only cart', async () => {
      arrangeCartFormat(BookFormat.EBOOK);
      mockQueryRunner.manager.save.mockImplementation((entity, data) =>
        entity === Order ? Promise.resolve({ ...data, id: 101 }) : Promise.resolve(data),
      );
      mockRazorpayProvider.initiatePayment.mockResolvedValue({
        transactionId: 'order_TXN123',
        orderId: 'order_TXN123',
        provider: PaymentProvider.RAZORPAY,
      });

      await expect(service.checkout(1, dtoWithoutAddress)).resolves.toBeDefined();
    });
  });
});
