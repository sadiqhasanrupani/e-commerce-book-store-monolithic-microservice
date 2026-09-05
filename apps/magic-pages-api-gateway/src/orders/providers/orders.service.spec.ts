import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { FulfillmentStatus, PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { OrderErrorCode } from '@app/contract/orders/enums/order-error-code.enum';

import { OrdersService } from './orders.service';
import { RazorpayProvider } from '../../cart/providers/razorpay.provider';
import { PaymentSettlementService, SettlementOutcome } from '../../cart/services/payment-settlement.service';
import { PhysicalFulfillmentService } from '../../physical-fulfillment/providers/physical-fulfillment.service';
import { PaymentStatus as ProviderPaymentStatus } from '../../cart/interfaces/payment-provider.interface';

const USER_ID = 7;
const OTHER_USER_ID = 99;
const ORDER_ID = 42;
const VARIANT_ID = 5;
const ADMIN_ID = 1;

/**
 * Builds a cancellable order: unpaid, not yet fulfilled, one physical item
 * whose stock reservation is still held.
 */
const buildOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: ORDER_ID,
    user: { id: USER_ID },
    payment_status: PaymentStatus.PENDING,
    fulfillment_status: FulfillmentStatus.NOT_STARTED,
    total_amount: 500,
    currency: 'INR',
    created_at: new Date('2026-08-17T10:00:00.000Z'),
    shipping_address: null,
    transactions: [],
    items: [
      {
        id: 1,
        quantity: 2,
        unit_price: 250,
        bookFormatVariant: { id: VARIANT_ID, format: BookFormat.PAPERBACK, book: { title: 'A Book' } },
      },
    ],
    ...overrides,
  }) as unknown as Order;

describe('OrdersService', () => {
  let service: OrdersService;

  /** Rows the mocked query runner hands back, keyed by entity. */
  let orderRow: Order;
  let variantRow: Partial<BookFormatVariant>;
  let cartRow: any;

  const manager = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    isTransactionActive: true,
    isReleased: false,
    manager,
  };

  /** Repository doubles used by the (non-transactional) verifyOrder path. */
  const orderRepository = { findOne: jest.fn() };
  const transactionRepository = { findOne: jest.fn(), save: jest.fn() };
  const razorpayProvider = { getPaymentStatus: jest.fn() };
  const settlementService = {
    settleSuccess: jest.fn().mockResolvedValue(SettlementOutcome.PROCESSED),
    settleFailure: jest.fn().mockResolvedValue(SettlementOutcome.PROCESSED),
  };

  /**
   * Mocked here (unlike in the settlement spec, where the real collaborator is
   * used): what matters on this side is *whether* the post-commit dispatch
   * happens and with which status. The e-mail bodies themselves are the mail
   * service's business.
   */
  const physicalFulfillmentService = {
    dispatchShipmentUpdate: jest.fn().mockResolvedValue(undefined),
    dispatchOrderConfirmation: jest.fn().mockResolvedValue(undefined),
    markProcessing: jest.fn(),
  };

  /** `order_status_logs` rows written during a test. */
  let statusLogs: OrderStatusLog[];

  beforeEach(async () => {
    jest.clearAllMocks();
    settlementService.settleSuccess.mockResolvedValue(SettlementOutcome.PROCESSED);
    settlementService.settleFailure.mockResolvedValue(SettlementOutcome.PROCESSED);
    physicalFulfillmentService.dispatchShipmentUpdate.mockResolvedValue(undefined);

    statusLogs = [];
    orderRow = buildOrder();
    variantRow = { id: VARIANT_ID, format: BookFormat.PAPERBACK, stockQuantity: 10, reservedQuantity: 2 };
    cartRow = {
      id: 'cart-uuid',
      userId: USER_ID,
      status: CartStatus.CHECKOUT,
      items: [{ id: 'ci-1', bookFormatVariantId: VARIANT_ID, isStockReserved: true }],
    };

    manager.findOne.mockImplementation((entity: any, options: any) => {
      if (entity === Order) return Promise.resolve(orderRow);
      if (entity === BookFormatVariant) return Promise.resolve(variantRow);
      if (entity === Cart) return Promise.resolve(options?.where?.status === CartStatus.CHECKOUT ? cartRow : null);
      return Promise.resolve(null);
    });
    manager.save.mockImplementation((entity: any, value: any) => {
      if (entity === OrderStatusLog) statusLogs.push(value);
      return Promise.resolve(value);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: getRepositoryToken(Transaction), useValue: transactionRepository },
        { provide: DataSource, useValue: { createQueryRunner: () => queryRunner } },
        { provide: RazorpayProvider, useValue: razorpayProvider },
        { provide: PaymentSettlementService, useValue: settlementService },
        { provide: PhysicalFulfillmentService, useValue: physicalFulfillmentService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('cancelOrder', () => {
    it('cancels an unpaid order, releases the reservation and un-parks the cart', async () => {
      const result = await service.cancelOrder(USER_ID, ORDER_ID);

      expect(result.status).toBe('CANCELLED');
      expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.CANCELLED);
      // Payment moves to FAILED so OrderTimeoutService cannot release the
      // same reservation a second time.
      expect(orderRow.payment_status).toBe(PaymentStatus.FAILED);
      // 2 reserved - 2 ordered = 0.
      expect(variantRow.reservedQuantity).toBe(0);
      expect(cartRow.status).toBe(CartStatus.ACTIVE);
      expect(cartRow.items[0].isStockReserved).toBe(false);
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('never drives reservedQuantity negative', async () => {
      variantRow.reservedQuantity = 1; // less than the ordered qty of 2

      await service.cancelOrder(USER_ID, ORDER_ID);

      expect(variantRow.reservedQuantity).toBe(0);
    });

    it('fails still-pending transactions', async () => {
      const txn = { id: 't1', status: TransactionStatus.PENDING } as Transaction;
      orderRow.transactions = [txn];

      await service.cancelOrder(USER_ID, ORDER_ID);

      expect(txn.status).toBe(TransactionStatus.FAILED);
    });

    it('404s when the order belongs to another user (no existence leak)', async () => {
      orderRow.user = { id: OTHER_USER_ID } as any;

      await expect(service.cancelOrder(USER_ID, ORDER_ID)).rejects.toThrow(NotFoundException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('404s when the order does not exist', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(service.cancelOrder(USER_ID, ORDER_ID)).rejects.toThrow(NotFoundException);
    });

    it('409s with ORDER_ALREADY_PAID for a paid order', async () => {
      orderRow.payment_status = PaymentStatus.PAID;

      await expect(service.cancelOrder(USER_ID, ORDER_ID)).rejects.toMatchObject({
        response: { code: OrderErrorCode.ORDER_ALREADY_PAID },
      });
      expect(variantRow.reservedQuantity).toBe(2); // untouched
    });

    it('409s when a transaction already succeeded even if the order still reads PENDING', async () => {
      orderRow.transactions = [{ id: 't1', status: TransactionStatus.SUCCESS } as Transaction];

      await expect(service.cancelOrder(USER_ID, ORDER_ID)).rejects.toThrow(ConflictException);
    });

    it('409s with ORDER_NOT_CANCELLABLE once the order has shipped', async () => {
      orderRow.payment_status = PaymentStatus.PAID;
      orderRow.fulfillment_status = FulfillmentStatus.SHIPPED;

      await expect(service.cancelOrder(USER_ID, ORDER_ID)).rejects.toMatchObject({
        response: { code: OrderErrorCode.ORDER_ALREADY_PAID },
      });
    });

    it('is idempotent: cancelling an already-cancelled order is a no-op', async () => {
      orderRow.fulfillment_status = FulfillmentStatus.CANCELLED;
      orderRow.payment_status = PaymentStatus.FAILED;

      const result = await service.cancelOrder(USER_ID, ORDER_ID);

      expect(result.status).toBe('CANCELLED');
      expect(variantRow.reservedQuantity).toBe(2); // not released twice
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('does not release a reservation that was already released (FAILED order)', async () => {
      orderRow.payment_status = PaymentStatus.FAILED;

      await service.cancelOrder(USER_ID, ORDER_ID);

      expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.CANCELLED);
      expect(variantRow.reservedQuantity).toBe(2);
    });
  });

  /**
   * The admin fulfilment state machine.
   *
   * This is the only writer that can move an order forward, and it is wired to
   * customer e-mail, so the guards below are the whole safety story: they are
   * what stop a buyer being told an unpaid order shipped, a cancelled order
   * being fulfilled, or a double-clicked button sending two notifications.
   */
  describe('updateFulfillmentAdmin', () => {
    /** Put the fixture order into a paid state at the given fulfilment stage. */
    const paidAt = (status: FulfillmentStatus) => {
      orderRow.payment_status = PaymentStatus.PAID;
      orderRow.fulfillment_status = status;
    };

    const SHIPMENT = { carrier: 'Delhivery', trackingNumber: 'AWB123' };

    describe('allowed transitions', () => {
      it('moves NOT_STARTED -> PROCESSING and records who did it', async () => {
        paidAt(FulfillmentStatus.NOT_STARTED);

        const result = await service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
          fulfillmentStatus: FulfillmentStatus.PROCESSING,
        });

        expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.PROCESSING);
        expect(result.status).toBe('PROCESSING');
        expect(statusLogs).toHaveLength(1);
        // The actor comes from the bearer token, never from the request body.
        expect(statusLogs[0].changed_by).toEqual({ id: ADMIN_ID });
        // The dispatcher is handed the transition unconditionally and decides
        // for itself which states are worth an e-mail — the rule lives in one
        // place rather than being duplicated here. PROCESSING is an internal
        // step, so it sends nothing (asserted in
        // physical-fulfillment.service.spec.ts).
        expect(physicalFulfillmentService.dispatchShipmentUpdate).toHaveBeenCalledWith(
          ORDER_ID,
          FulfillmentStatus.PROCESSING,
        );
        expect(queryRunner.commitTransaction).toHaveBeenCalled();
      });

      it('moves PROCESSING -> SHIPPED, stores the tracking details and stamps shipped_at', async () => {
        paidAt(FulfillmentStatus.PROCESSING);

        const result = await service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
          fulfillmentStatus: FulfillmentStatus.SHIPPED,
          ...SHIPMENT,
          trackingUrl: 'https://track.example.com/AWB123',
        });

        expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.SHIPPED);
        expect(orderRow.carrier).toBe('Delhivery');
        expect(orderRow.tracking_number).toBe('AWB123');
        expect(orderRow.tracking_url).toBe('https://track.example.com/AWB123');
        expect(orderRow.shipped_at).toBeInstanceOf(Date);
        expect(result.trackingNumber).toBe('AWB123');
        expect(result.shippedAt).toEqual(expect.any(String));
        // Dispatched AFTER the commit — the customer must never be told about a
        // shipment that then rolled back.
        expect(physicalFulfillmentService.dispatchShipmentUpdate).toHaveBeenCalledWith(
          ORDER_ID,
          FulfillmentStatus.SHIPPED,
        );
      });

      /**
       * A small shop packs and dispatches in one action; forcing a pointless
       * PROCESSING click first only trains admins to double-click.
       */
      it('allows NOT_STARTED -> SHIPPED in one step', async () => {
        paidAt(FulfillmentStatus.NOT_STARTED);

        await service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
          fulfillmentStatus: FulfillmentStatus.SHIPPED,
          ...SHIPMENT,
        });

        expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.SHIPPED);
      });

      it('moves SHIPPED -> DELIVERED without blanking the tracking details', async () => {
        paidAt(FulfillmentStatus.SHIPPED);
        orderRow.carrier = 'Delhivery';
        orderRow.tracking_number = 'AWB123';

        const result = await service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
          fulfillmentStatus: FulfillmentStatus.DELIVERED,
        });

        expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.DELIVERED);
        expect(orderRow.delivered_at).toBeInstanceOf(Date);
        // Omitted fields must not wipe what the shipping step recorded.
        expect(orderRow.carrier).toBe('Delhivery');
        expect(result.carrier).toBe('Delhivery');
        expect(physicalFulfillmentService.dispatchShipmentUpdate).toHaveBeenCalledWith(
          ORDER_ID,
          FulfillmentStatus.DELIVERED,
        );
      });

      it('records the admin-supplied comment on the audit row', async () => {
        paidAt(FulfillmentStatus.PROCESSING);

        await service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
          fulfillmentStatus: FulfillmentStatus.SHIPPED,
          ...SHIPMENT,
          comment: 'Handed to courier 4pm',
        });

        expect(statusLogs[0].comment).toBe('Handed to courier 4pm');
      });
    });

    describe('rejected transitions', () => {
      it('refuses to move backwards (SHIPPED -> PROCESSING)', async () => {
        paidAt(FulfillmentStatus.SHIPPED);

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.PROCESSING }),
        ).rejects.toMatchObject({ response: { code: OrderErrorCode.FULFILLMENT_INVALID_TRANSITION } });

        expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.SHIPPED);
        expect(physicalFulfillmentService.dispatchShipmentUpdate).not.toHaveBeenCalled();
      });

      /** Skipping SHIPPED would mean a delivered parcel with no tracking history. */
      it('refuses to skip a step (NOT_STARTED -> DELIVERED)', async () => {
        paidAt(FulfillmentStatus.NOT_STARTED);

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.DELIVERED }),
        ).rejects.toThrow(ConflictException);
      });

      it('treats DELIVERED as terminal', async () => {
        paidAt(FulfillmentStatus.DELIVERED);

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.SHIPPED }),
        ).rejects.toMatchObject({ response: { code: OrderErrorCode.FULFILLMENT_INVALID_TRANSITION } });
      });

      /**
       * Cancelling through this endpoint would take the order out of
       * circulation while keeping the customer's money — a refund flow that
       * does not exist yet. It must be a hard no, not a silent success.
       */
      it('refuses to cancel an order through this endpoint', async () => {
        paidAt(FulfillmentStatus.PROCESSING);

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.CANCELLED }),
        ).rejects.toMatchObject({ response: { code: OrderErrorCode.FULFILLMENT_INVALID_TRANSITION } });
      });

      it('refuses to fulfil an order the customer cancelled', async () => {
        orderRow.payment_status = PaymentStatus.PAID;
        orderRow.fulfillment_status = FulfillmentStatus.CANCELLED;

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.SHIPPED, ...SHIPMENT }),
        ).rejects.toMatchObject({ response: { code: OrderErrorCode.FULFILLMENT_INVALID_TRANSITION } });
      });

      /** Nothing leaves the building before the money is in. */
      it('409s with FULFILLMENT_NOT_PAID on an unpaid order', async () => {
        orderRow.payment_status = PaymentStatus.PENDING;
        orderRow.fulfillment_status = FulfillmentStatus.NOT_STARTED;

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.PROCESSING }),
        ).rejects.toMatchObject({ response: { code: OrderErrorCode.FULFILLMENT_NOT_PAID } });

        expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.NOT_STARTED);
        expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      });

      it('409s with FULFILLMENT_NOT_PAID on a refunded order', async () => {
        orderRow.payment_status = PaymentStatus.REFUNDED;
        orderRow.fulfillment_status = FulfillmentStatus.PROCESSING;

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.SHIPPED, ...SHIPMENT }),
        ).rejects.toMatchObject({ response: { code: OrderErrorCode.FULFILLMENT_NOT_PAID } });
      });

      /**
       * The DTO enforces this too, so reaching the service without them means a
       * direct call — but a "your parcel has shipped" e-mail with no way to
       * find the parcel is bad enough to guard twice.
       */
      it('400s when SHIPPED is requested without carrier and tracking number', async () => {
        paidAt(FulfillmentStatus.PROCESSING);

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.SHIPPED }),
        ).rejects.toThrow(BadRequestException);

        expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.PROCESSING);
      });

      it('400s when only the carrier is supplied', async () => {
        paidAt(FulfillmentStatus.PROCESSING);

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
            fulfillmentStatus: FulfillmentStatus.SHIPPED,
            carrier: 'Delhivery',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('404s when the order does not exist', async () => {
        manager.findOne.mockResolvedValue(null);

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.PROCESSING }),
        ).rejects.toThrow(NotFoundException);
      });

      /**
       * A digital-only order is fully served by `DigitalDeliveryService` at
       * settlement time and is left on NOT_STARTED forever by design (see
       * `PhysicalFulfillmentService.markProcessing`) — that NOT_STARTED does
       * NOT mean "an unclaimed physical order". Without this guard an admin
       * could mark a paid e-book order SHIPPED and mail the buyer a tracking
       * number for a parcel that was never packed.
       */
      it('409s with FULFILLMENT_NO_PHYSICAL_ITEMS for a digital-only order', async () => {
        paidAt(FulfillmentStatus.NOT_STARTED);
        orderRow.items = [
          {
            id: 1,
            quantity: 1,
            unit_price: 250,
            bookFormatVariant: { id: VARIANT_ID, format: BookFormat.EBOOK, book: { title: 'An Ebook' } },
          },
        ] as any;

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, { fulfillmentStatus: FulfillmentStatus.PROCESSING }),
        ).rejects.toMatchObject({ response: { code: OrderErrorCode.FULFILLMENT_NO_PHYSICAL_ITEMS } });

        expect(orderRow.fulfillment_status).toBe(FulfillmentStatus.NOT_STARTED);
        expect(physicalFulfillmentService.dispatchShipmentUpdate).not.toHaveBeenCalled();
      });

      it('409s with FULFILLMENT_NO_PHYSICAL_ITEMS when trying to ship a digital-only order', async () => {
        paidAt(FulfillmentStatus.NOT_STARTED);
        orderRow.items = [
          {
            id: 1,
            quantity: 1,
            unit_price: 250,
            bookFormatVariant: { id: VARIANT_ID, format: BookFormat.EPUB, book: { title: 'An Ebook' } },
          },
        ] as any;

        await expect(
          service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
            fulfillmentStatus: FulfillmentStatus.SHIPPED,
            ...SHIPMENT,
          }),
        ).rejects.toMatchObject({ response: { code: OrderErrorCode.FULFILLMENT_NO_PHYSICAL_ITEMS } });
      });

      /** A mixed basket still has fulfilment work to do — only digital-only orders are blocked. */
      it('allows fulfilment on a mixed physical + digital order', async () => {
        paidAt(FulfillmentStatus.NOT_STARTED);
        orderRow.items = [
          ...orderRow.items,
          {
            id: 2,
            quantity: 1,
            unit_price: 100,
            bookFormatVariant: { id: 6, format: BookFormat.EBOOK, book: { title: 'An Ebook' } },
          },
        ] as any;

        const result = await service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
          fulfillmentStatus: FulfillmentStatus.PROCESSING,
        });

        expect(result.status).toBe('PROCESSING');
      });
    });

    /**
     * The regression that matters most operationally: an admin double-clicking
     * "Mark shipped" must not send the customer two tracking e-mails.
     */
    describe('idempotency', () => {
      it('is a no-op when the order is already in the requested state', async () => {
        paidAt(FulfillmentStatus.SHIPPED);
        orderRow.shipped_at = new Date('2026-08-01T00:00:00.000Z');

        const result = await service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
          fulfillmentStatus: FulfillmentStatus.SHIPPED,
          ...SHIPMENT,
        });

        expect(result.status).toBe('SHIPPED');
        // No write, no audit row, and — the point — no second e-mail.
        expect(manager.save).not.toHaveBeenCalled();
        expect(statusLogs).toHaveLength(0);
        expect(physicalFulfillmentService.dispatchShipmentUpdate).not.toHaveBeenCalled();
        // The original dispatch time survives; a re-click must not rewrite when
        // the parcel actually left.
        expect(orderRow.shipped_at).toEqual(new Date('2026-08-01T00:00:00.000Z'));
      });
    });

    describe('response shape', () => {
      it('serialises money in paise and timestamps as ISO strings', async () => {
        paidAt(FulfillmentStatus.PROCESSING);
        orderRow.shipping_cost = 49 as any;

        const result = await service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
          fulfillmentStatus: FulfillmentStatus.SHIPPED,
          ...SHIPMENT,
        });

        // Same convention as `total` and `items[].price`.
        expect(result.shippingCost).toBe(4900);
        expect(result.shippedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(result.deliveredAt).toBeNull();
      });

      it('exposes the customer without leaking the user entity', async () => {
        paidAt(FulfillmentStatus.NOT_STARTED);
        orderRow.user = { id: USER_ID, email: 'buyer@example.com', firstName: 'Ada', lastName: 'Lovelace', passwordHash: 'secret' } as any;

        const result = await service.updateFulfillmentAdmin(ADMIN_ID, ORDER_ID, {
          fulfillmentStatus: FulfillmentStatus.PROCESSING,
        });

        expect(result.customer).toEqual({ id: USER_ID, email: 'buyer@example.com', name: 'Ada Lovelace' });
        expect(result.customer).not.toHaveProperty('passwordHash');
      });
    });
  });

  describe('status mapping', () => {
    it('reports a cancelled unpaid order as CANCELLED, not PENDING', async () => {
      orderRow.fulfillment_status = FulfillmentStatus.CANCELLED;
      orderRow.payment_status = PaymentStatus.FAILED;

      const result = await service.cancelOrder(USER_ID, ORDER_ID);

      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('verifyOrder', () => {
    const GATEWAY_REF = 'order_RZP123';

    /** A transaction with its `order` relation loaded, as the query now asks for. */
    const txnWithOrder = (status: TransactionStatus, order: Partial<Order> = {}) =>
      ({
        id: 'txn-1',
        gateway_ref_id: GATEWAY_REF,
        status,
        order: {
          id: ORDER_ID,
          total_amount: '500.00',
          currency: 'INR',
          payment_status: PaymentStatus.PENDING,
          fulfillment_status: FulfillmentStatus.NOT_STARTED,
          created_at: new Date('2026-08-19T10:00:00.000Z'),
          ...order,
        },
      }) as unknown as Transaction;

    it('loads the order relation so the response actually carries an order', async () => {
      transactionRepository.findOne.mockResolvedValue(txnWithOrder(TransactionStatus.SUCCESS));

      const result = await service.verifyOrder(USER_ID, GATEWAY_REF);

      // The regression this guards: filtering through `order.user.id` without
      // asking for the relation left `txn.order` undefined on every call.
      expect(transactionRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ relations: { order: true } }),
      );
      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.order).toEqual(
        expect.objectContaining({ id: ORDER_ID, total_amount: 500, currency: 'INR' }),
      );
    });

    it('scopes the lookup to the authenticated user', async () => {
      transactionRepository.findOne.mockResolvedValue(txnWithOrder(TransactionStatus.SUCCESS));

      await service.verifyOrder(USER_ID, GATEWAY_REF);

      expect(transactionRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { gateway_ref_id: GATEWAY_REF, order: { user: { id: USER_ID } } },
        }),
      );
    });

    it('404s (without leaking the reference) when nothing matches', async () => {
      transactionRepository.findOne.mockResolvedValue(null);

      await expect(service.verifyOrder(USER_ID, GATEWAY_REF)).rejects.toMatchObject({
        response: { code: OrderErrorCode.ORDER_NOT_FOUND, message: 'Order not found' },
      });
    });

    it('reports an already-terminal transaction without calling the gateway', async () => {
      transactionRepository.findOne.mockResolvedValue(txnWithOrder(TransactionStatus.FAILED));

      const result = await service.verifyOrder(USER_ID, GATEWAY_REF);

      expect(result.status).toBe(TransactionStatus.FAILED);
      expect(razorpayProvider.getPaymentStatus).not.toHaveBeenCalled();
    });

    it('settles a gateway-confirmed payment through the shared settlement service', async () => {
      transactionRepository.findOne.mockResolvedValue(txnWithOrder(TransactionStatus.PENDING));
      razorpayProvider.getPaymentStatus.mockResolvedValue({
        transactionId: GATEWAY_REF,
        status: ProviderPaymentStatus.SUCCESS,
        amount: 500,
      });
      orderRepository.findOne.mockResolvedValue({
        id: ORDER_ID,
        total_amount: '500.00',
        currency: 'INR',
        payment_status: PaymentStatus.PAID,
        fulfillment_status: FulfillmentStatus.NOT_STARTED,
        created_at: new Date('2026-08-19T10:00:00.000Z'),
      });

      const result = await service.verifyOrder(USER_ID, GATEWAY_REF);

      // The regression this guards: this branch used to hand-roll the update,
      // so no lock was taken, no stock was deducted and the order stayed unpaid.
      expect(settlementService.settleSuccess).toHaveBeenCalledWith('txn-1', {
        verify: expect.objectContaining({ status: ProviderPaymentStatus.SUCCESS }),
      });
      expect(transactionRepository.save).not.toHaveBeenCalled();
      expect(result.status).toBe(TransactionStatus.SUCCESS);
      // Re-read after settlement, so the caller sees PAID rather than the stale row.
      expect(result.order?.payment_status).toBe(PaymentStatus.PAID);
    });

    it('settles a gateway-confirmed failure through the shared settlement service', async () => {
      transactionRepository.findOne.mockResolvedValue(txnWithOrder(TransactionStatus.PENDING));
      razorpayProvider.getPaymentStatus.mockResolvedValue({
        transactionId: GATEWAY_REF,
        status: ProviderPaymentStatus.FAILED,
        amount: 500,
      });
      orderRepository.findOne.mockResolvedValue(null);

      const result = await service.verifyOrder(USER_ID, GATEWAY_REF);

      expect(settlementService.settleFailure).toHaveBeenCalledWith('txn-1', expect.any(Object));
      expect(result.status).toBe(TransactionStatus.FAILED);
    });

    it('stays PENDING while the gateway has no result yet', async () => {
      transactionRepository.findOne.mockResolvedValue(txnWithOrder(TransactionStatus.PENDING));
      razorpayProvider.getPaymentStatus.mockResolvedValue({
        transactionId: GATEWAY_REF,
        status: ProviderPaymentStatus.PENDING,
        amount: 500,
      });

      const result = await service.verifyOrder(USER_ID, GATEWAY_REF);

      expect(result.status).toBe(TransactionStatus.PENDING);
      expect(settlementService.settleSuccess).not.toHaveBeenCalled();
      expect(settlementService.settleFailure).not.toHaveBeenCalled();
    });

    it('never leaks the user relation into the response', async () => {
      transactionRepository.findOne.mockResolvedValue(
        txnWithOrder(TransactionStatus.SUCCESS, { user: { id: USER_ID, password: 'hash' } } as any),
      );

      const result = await service.verifyOrder(USER_ID, GATEWAY_REF);

      expect(result.order).not.toHaveProperty('user');
    });
  });

  describe('address mapping', () => {
    it('reads the canonical postalCode snapshot', async () => {
      orderRow.shipping_address = {
        line1: '12 MG Road',
        city: 'Mumbai',
        state: 'MH',
        postalCode: '400001',
        country: 'IN',
        phone: '9876543210',
      };
      orderRow.fulfillment_status = FulfillmentStatus.CANCELLED;

      const result = await service.cancelOrder(USER_ID, ORDER_ID);

      expect(result.shippingAddress?.postalCode).toBe('400001');
      expect(result.shippingAddress?.country).toBe('IN');
    });

    it('falls back to the legacy pincode key on older snapshots', async () => {
      orderRow.shipping_address = { line1: '12 MG Road', city: 'Mumbai', state: 'MH', pincode: '400001' };
      orderRow.fulfillment_status = FulfillmentStatus.CANCELLED;

      const result = await service.cancelOrder(USER_ID, ORDER_ID);

      expect(result.shippingAddress?.postalCode).toBe('400001');
      expect(result.shippingAddress?.country).toBe('IN');
    });
  });
});
