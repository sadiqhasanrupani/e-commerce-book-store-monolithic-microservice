import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutService } from './checkout.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';

describe('CheckoutService', () => {
  let service: CheckoutService;
  let dataSource: DataSource;
  let paymentProvider: any;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      save: jest.fn(),
      decrement: jest.fn(),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockPaymentProvider = {
    initiatePayment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        {
          provide: getRepositoryToken(Cart),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Order),
          useValue: {},
        },
        {
          provide: getRepositoryToken(OrderItem),
          useValue: {},
        },
        {
          provide: getRepositoryToken(BookFormatVariant),
          useValue: {},
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: 'PAYMENT_PROVIDER',
          useValue: mockPaymentProvider,
        },
        ConfigService,
      ],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
    dataSource = module.get<DataSource>(DataSource);
    paymentProvider = module.get('PAYMENT_PROVIDER');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkout', () => {
    it('should successfully checkout a cart', async () => {
      const userId = 1;
      const dto = {
        paymentMethod: PaymentProvider.PHONEPE,
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
            bookFormatVariant: {
              id: 1,
              format: BookFormat.PHYSICAL,
              stockQuantity: 10,
              reservedQuantity: 0,
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

      mockPaymentProvider.initiatePayment.mockResolvedValue({
        transactionId: 'TXN_123',
        paymentUrl: 'http://payment.url',
      });

      const result = await service.checkout(userId, dto);

      expect(result).toBeDefined();
      expect(result.transactionId).toBe('TXN_123');
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.decrement).toHaveBeenCalledTimes(2); // Stock and Reserved
    });

    it('should rollback transaction on error', async () => {
      mockQueryRunner.manager.findOne.mockRejectedValue(new Error('DB Error'));

      await expect(service.checkout(1, {} as any)).rejects.toThrow('DB Error');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });
});
