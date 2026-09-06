import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { DigitalDeliveryStatus } from '@app/contract/orders/enums/digital-delivery-status.enum';
import { FulfillmentStatus, PaymentStatus } from '@app/contract/orders/enums/order-status.enum';

import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';

import { Invoice } from '@app/contract/invoices/entities/invoice.entity';
import { InvoiceItem } from '@app/contract/invoices/entities/invoice-item.entity';
import { InvoiceEmailData } from '@app/contract/mail/interfaces/invoice-email.interface';

import { PaymentSettlementService, SettlementOutcome } from './payment-settlement.service';
import { DigitalDeliveryService } from '../../digital-delivery/providers/digital-delivery.service';
import { PhysicalFulfillmentService } from '../../physical-fulfillment/providers/physical-fulfillment.service';
import { InvoiceIssuanceService } from '../../invoices/providers/invoice-issuance.service';
import { InvoiceNumberProvider } from '../../invoices/providers/invoice-number.provider';
import { MailService } from '../../mail/mail.service';

const TRANSACTION_ID = 'txn-uuid-1';
const GATEWAY_REF = 'order_RazorpayRef1';
const ORDER_ID = 42;
const DIGITAL_ITEM_ID = 10;
const PHYSICAL_ITEM_ID = 11;
const BUYER_EMAIL = 'buyer@example.com';

/**
 * Fixture money, tax INCLUSIVE (a component of the total, never added to it):
 *   ebook     250.00 x 1 = 250.00, 18% -> 250 * 18/118 = 38.14 tax
 *   paperback 150.00 x 2 = 300.00,  5% -> 300 *  5/105 = 14.29 tax
 *   items     = 550.00, shipping = 50.00, total_amount = 600.00, tax = 52.43
 */
const ORDER_TOTAL = '600.00';
const ORDER_TAX = '52.43';
const ORDER_SHIPPING = '50.00';

/**
 * Settlement + digital delivery, wired together for real.
 *
 * `DigitalDeliveryService` is deliberately NOT mocked here: the behaviour under
 * test is the handshake between the two — settlement claims lines inside its
 * transaction, delivery sends after the commit — and mocking the collaborator
 * would assert that we call a function, not that a buyer gets exactly one
 * e-mail. Only the two edges are faked: the database (an in-memory stand-in
 * that honours the conditional UPDATE the claim relies on) and SMTP.
 */
describe('PaymentSettlementService — digital delivery', () => {
  let service: PaymentSettlementService;
  let mailService: {
    sendDigitalDeliveryEmail: jest.Mock;
    sendOrderConfirmationEmail: jest.Mock;
    sendOrderShippedEmail: jest.Mock;
    sendOrderDeliveredEmail: jest.Mock;
    sendInvoiceEmail: jest.Mock;
  };

  /**
   * The mutable rows our fake database holds. Reassigned per test, and mutated
   * by the fake manager's save/query handlers exactly as Postgres would — this
   * is what lets a second settlement observe the first one's writes.
   */
  let state: {
    transactionStatus: TransactionStatus;
    orderPaymentStatus: PaymentStatus;
    orderFulfillmentStatus: FulfillmentStatus;
    itemDeliveryStatus: Map<number, DigitalDeliveryStatus | null>;
  };

  const buildOrder = (): any => ({
    id: ORDER_ID,
    payment_status: state.orderPaymentStatus,
    fulfillment_status: state.orderFulfillmentStatus,
    currency: 'INR',
    total_amount: ORDER_TOTAL,
    tax_amount: ORDER_TAX,
    shipping_cost: ORDER_SHIPPING,
    shipping_address: {
      line1: '12, MG Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400001',
      country: 'IN',
      phone: '+91-9876543210',
    },
    user: { id: 7, email: BUYER_EMAIL, firstName: 'Ada' },
    items: [
      {
        id: DIGITAL_ITEM_ID,
        quantity: 1,
        unit_price: '250.00',
        total_price: '250.00',
        tax_percentage: '18.00',
        tax_amount: '38.14',
        bookFormatVariant: {
          id: 100,
          format: BookFormat.EBOOK,
          fileUrl: 'http://minio:9000/bucket/books/the-book.pdf',
          book: { title: 'The Digital Book' },
        },
      },
      {
        id: PHYSICAL_ITEM_ID,
        quantity: 2,
        unit_price: '150.00',
        total_price: '300.00',
        tax_percentage: '5.00',
        tax_amount: '14.29',
        bookFormatVariant: {
          id: 101,
          format: BookFormat.PAPERBACK,
          isbn: '978-3-16-148410-0',
          book: { title: 'A Paperback' },
        },
      },
    ],
  });

  /** Stands in for the settlement transaction's EntityManager. */
  const manager = {
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    decrement: jest.fn(),
    query: jest.fn(),
    // Needed by InvoiceIssuanceService, which builds its rows through the
    // manager the way the rest of the codebase does.
    create: jest.fn((_entity: any, plain: any) => ({ ...plain })),
  };

  /** `order_status_logs` rows written during a settlement. */
  let statusLogs: OrderStatusLog[];

  /** `invoices` rows, keyed by id, with the UNIQUE index on `order_id` modelled. */
  let invoices: Map<string, Invoice>;
  /** `invoice_items` rows. */
  let invoiceItems: InvoiceItem[];
  /** `invoice_daily_counters.counter` for today. */
  let invoiceCounter: number;

  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    isTransactionActive: true,
    isReleased: false,
    manager,
    // Backs InvoiceNumberProvider's atomic daily-counter upsert. The invoice
    // service opens its own query runner; this fake hands back the same object,
    // which is harmless because every transaction control method is a spy.
    query: jest.fn(() => Promise.resolve([{ counter: ++invoiceCounter }])),
  };

  /**
   * Stands in for `Repository<OrderItem>.update(ids, values)`, which is how
   * DigitalDeliveryService records the delivery outcome. It applies the write
   * back into `state`, so a later settlement sees the DELIVERED/FAILED status
   * the earlier one recorded — the whole point of the idempotency tests below.
   */
  const itemUpdate = jest.fn((ids: number[], values: Partial<OrderItem>) => {
    for (const id of ids) {
      state.itemDeliveryStatus.set(id, values.digital_delivery_status ?? null);
    }
    return Promise.resolve({ affected: ids.length });
  });

  const dataSource = {
    createQueryRunner: jest.fn(() => queryRunner),
    getRepository: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    statusLogs = [];
    invoices = new Map();
    invoiceItems = [];
    invoiceCounter = 0;
    state = {
      transactionStatus: TransactionStatus.PENDING,
      orderPaymentStatus: PaymentStatus.PENDING,
      orderFulfillmentStatus: FulfillmentStatus.NOT_STARTED,
      itemDeliveryStatus: new Map([
        [DIGITAL_ITEM_ID, null],
        [PHYSICAL_ITEM_ID, null],
      ]),
    };

    // --- fake reads -------------------------------------------------------
    manager.findOne.mockImplementation((entity: any, options: any) => {
      if (entity === Transaction) {
        // The second lookup (`select: {id, status}`) is settlement's
        // idempotency gate — it must always report the CURRENT status.
        if (options?.select) {
          return Promise.resolve({ id: TRANSACTION_ID, status: state.transactionStatus });
        }
        return Promise.resolve({
          id: TRANSACTION_ID,
          status: state.transactionStatus,
          gateway_ref_id: GATEWAY_REF,
          raw_response: {},
          order: buildOrder(),
        });
      }

      if (entity === Order) {
        return Promise.resolve({
          id: ORDER_ID,
          payment_status: state.orderPaymentStatus,
          fulfillment_status: state.orderFulfillmentStatus,
        });
      }

      if (entity === Cart) {
        return Promise.resolve(null);
      }

      return Promise.resolve(null);
    });

    // --- fake writes ------------------------------------------------------
    manager.save.mockImplementation((entity: any, value: any) => {
      if (entity === Transaction) state.transactionStatus = value.status;
      if (entity === Order) state.orderPaymentStatus = value.payment_status;
      if (entity === OrderStatusLog) statusLogs.push(value);

      if (entity === Invoice) {
        const row = value as Invoice;

        // The UNIQUE index on `invoices.order_id`, modelled faithfully: it — not
        // any application check — is what makes invoicing exactly-once, because
        // invoicing deliberately happens outside the settlement transaction.
        const clash = [...invoices.values()].some((existing) => existing.orderId === row.orderId);
        if (clash) {
          return Promise.reject(Object.assign(new Error('duplicate key value'), { code: '23505' }));
        }
        const saved: Invoice = { ...row, id: `invoice-${invoices.size + 1}` };
        invoices.set(saved.id, saved);
        return Promise.resolve(saved);
      }

      if (entity === InvoiceItem) {
        const rows = (Array.isArray(value) ? value : [value]) as InvoiceItem[];
        invoiceItems.push(...rows);
        return Promise.resolve(rows);
      }

      return Promise.resolve(value);
    });

    /**
     * The conditional UPDATE behind the physical claim, mirrored from Postgres:
     * the row moves to PROCESSING only while it still reads NOT_STARTED, and
     * `affected` reports whether this caller was the one that moved it. That
     * count is the entire idempotency gate for the confirmation e-mail.
     */
    manager.update.mockImplementation((entity: any, criteria: any, values: any) => {
      if (entity !== Order) {
        return Promise.resolve({ affected: 0 });
      }

      if (state.orderFulfillmentStatus !== criteria.fulfillment_status) {
        return Promise.resolve({ affected: 0 });
      }

      state.orderFulfillmentStatus = values.fulfillment_status;
      return Promise.resolve({ affected: 1 });
    });

    /**
     * The conditional UPDATE that makes delivery exactly-once. Mirrors the real
     * predicate: a row is claimable only from NULL or FAILED, and the statement
     * returns just the rows it actually changed.
     */
    manager.query.mockImplementation((_sql: string, params: any[]) => {
      const [nextStatus, ids, failedStatus] = params;
      const claimed: Array<{ order_item_id: number }> = [];

      for (const id of ids as number[]) {
        const current = state.itemDeliveryStatus.get(id) ?? null;
        if (current === null || current === failedStatus) {
          state.itemDeliveryStatus.set(id, nextStatus);
          claimed.push({ order_item_id: id });
        }
      }

      // Return the shape TypeORM actually produces for `UPDATE … RETURNING`:
      // a `[rows, affectedCount]` tuple, NOT a bare row array. An earlier
      // version of this fake returned the bare array and hid a real bug — the
      // service read the affected count as a row and derived NaN ids from it.
      return Promise.resolve([claimed, claimed.length]);
    });

    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity === Order) {
        return { findOne: jest.fn().mockResolvedValue(buildOrder()) };
      }
      if (entity === OrderItem) {
        return { update: itemUpdate };
      }
      if (entity === Invoice) {
        return {
          findOne: jest.fn(({ where }: { where: { orderId: number } }) =>
            Promise.resolve([...invoices.values()].find((row) => row.orderId === where.orderId) ?? null),
          ),
          update: jest.fn((id: string, values: Partial<Invoice>) => {
            const row = invoices.get(id);
            if (row) Object.assign(row, values);
            return Promise.resolve({ affected: row ? 1 : 0 });
          }),
        };
      }
      return {};
    });

    mailService = {
      sendDigitalDeliveryEmail: jest.fn().mockResolvedValue(undefined),
      sendOrderConfirmationEmail: jest.fn().mockResolvedValue(undefined),
      sendOrderShippedEmail: jest.fn().mockResolvedValue(undefined),
      sendOrderDeliveredEmail: jest.fn().mockResolvedValue(undefined),
      sendInvoiceEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentSettlementService,
        DigitalDeliveryService,
        // Not mocked, for the same reason DigitalDeliveryService is not: the
        // behaviour under test is the handshake between settlement and
        // fulfilment (claim inside the transaction, e-mail after the commit),
        // and a mock would only assert that we call a function.
        PhysicalFulfillmentService,
        // Also unmocked, and for the same reason: the guarantee under test is
        // that a re-settled order produces exactly ONE invoice, and only the
        // real service talking to a store that enforces the unique index can
        // demonstrate that.
        InvoiceIssuanceService,
        InvoiceNumberProvider,
        { provide: DataSource, useValue: dataSource },
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: { get: () => 'https://storefront.test' } },
      ],
    }).compile();

    service = module.get<PaymentSettlementService>(PaymentSettlementService);
  });

  it('emails the digital material once on a successful settlement', async () => {
    const outcome = await service.settleSuccess(TRANSACTION_ID);

    expect(outcome).toBe(SettlementOutcome.PROCESSED);
    expect(mailService.sendDigitalDeliveryEmail).toHaveBeenCalledTimes(1);

    const [email, name, orderNumber, titles] = mailService.sendDigitalDeliveryEmail.mock.calls[0];
    expect(email).toBe(BUYER_EMAIL);
    expect(name).toBe('Ada');
    expect(orderNumber).toBe('MP-000042');
    // Only the digital line is delivered — the paperback ships.
    expect(titles).toEqual(['The Digital Book']);
  });

  /**
   * THE regression this feature must never lose.
   *
   * Settlement is reachable three ways (Razorpay webhook, reconciliation cron,
   * the storefront's `verifyOrder` poll) and all three routinely land on the
   * same order. Before the per-item claim existed, "deliver the digital items"
   * would have run on each of them, mailing the buyer their ebook two or three
   * times.
   */
  it('does not email again when the same order is settled twice', async () => {
    const first = await service.settleSuccess(TRANSACTION_ID);
    const second = await service.settleSuccess(TRANSACTION_ID);

    expect(first).toBe(SettlementOutcome.PROCESSED);
    // The second caller finds the transaction already SUCCESS and stops.
    expect(second).toBe(SettlementOutcome.ALREADY_PROCESSED);
    expect(mailService.sendDigitalDeliveryEmail).toHaveBeenCalledTimes(1);
  });

  /**
   * Belt and braces for the same guarantee, one layer lower.
   *
   * The test above is satisfied by the transaction-status gate alone, so it
   * would still pass if the per-item claim were deleted. This one forces the
   * claim itself to do the work: the transaction is rewound to PENDING between
   * calls, so settlement runs its whole body a second time and only the
   * `digital_delivery_status` check can stop the second e-mail.
   */
  it('does not email again when settlement re-runs its body on an already-delivered order', async () => {
    await service.settleSuccess(TRANSACTION_ID);
    expect(mailService.sendDigitalDeliveryEmail).toHaveBeenCalledTimes(1);

    state.transactionStatus = TransactionStatus.PENDING;
    state.orderPaymentStatus = PaymentStatus.PENDING;

    await service.settleSuccess(TRANSACTION_ID);

    expect(mailService.sendDigitalDeliveryEmail).toHaveBeenCalledTimes(1);
    expect(state.itemDeliveryStatus.get(DIGITAL_ITEM_ID)).toBe(DigitalDeliveryStatus.DELIVERED);
  });

  it('sends nothing for an order with only physical items', async () => {
    manager.findOne.mockImplementation((entity: any, options: any) => {
      if (entity === Transaction) {
        if (options?.select) {
          return Promise.resolve({ id: TRANSACTION_ID, status: state.transactionStatus });
        }
        const order = buildOrder();
        order.items = order.items.filter((item: any) => item.id === PHYSICAL_ITEM_ID);
        return Promise.resolve({ id: TRANSACTION_ID, status: state.transactionStatus, raw_response: {}, order });
      }
      if (entity === Order) {
        return Promise.resolve({
          id: ORDER_ID,
          payment_status: state.orderPaymentStatus,
          fulfillment_status: state.orderFulfillmentStatus,
        });
      }
      return Promise.resolve(null);
    });

    await service.settleSuccess(TRANSACTION_ID);

    expect(mailService.sendDigitalDeliveryEmail).not.toHaveBeenCalled();
    // No claim statement should even be issued.
    expect(manager.query).not.toHaveBeenCalled();
  });

  /**
   * A cancelled-but-paid order needs a refund, not a delivery. Handing over the
   * material here would give away a product we are about to refund.
   */
  it('does not deliver when payment lands on an already-cancelled order', async () => {
    state.orderFulfillmentStatus = FulfillmentStatus.CANCELLED;

    const outcome = await service.settleSuccess(TRANSACTION_ID);

    expect(outcome).toBe(SettlementOutcome.REFUND_REQUIRED);
    expect(mailService.sendDigitalDeliveryEmail).not.toHaveBeenCalled();
  });

  /**
   * SMTP being down must not fail the webhook. Razorpay retries non-2xx
   * responses, so throwing here would make it redeliver a payment we have
   * already settled correctly.
   */
  it('still settles the payment when the delivery email fails', async () => {
    mailService.sendDigitalDeliveryEmail.mockRejectedValue(new Error('SMTP unavailable'));

    const outcome = await service.settleSuccess(TRANSACTION_ID);

    expect(outcome).toBe(SettlementOutcome.PROCESSED);
    expect(state.transactionStatus).toBe(TransactionStatus.SUCCESS);
    expect(state.orderPaymentStatus).toBe(PaymentStatus.PAID);
    // The line is recorded FAILED rather than left claimed-but-unsent.
    expect(itemUpdate).toHaveBeenCalledWith([DIGITAL_ITEM_ID], {
      digital_delivery_status: DigitalDeliveryStatus.FAILED,
    });
  });

  /**
   * A FAILED line is deliberately re-claimable, so a later settlement (or a
   * future re-drive) can have another go at a delivery whose mail bounced.
   */
  it('retries delivery for a line left in FAILED', async () => {
    state.itemDeliveryStatus.set(DIGITAL_ITEM_ID, DigitalDeliveryStatus.FAILED);

    await service.settleSuccess(TRANSACTION_ID);

    expect(mailService.sendDigitalDeliveryEmail).toHaveBeenCalledTimes(1);
  });

  /** The physical half of settlement must be untouched by any of this. */
  it('still deducts stock for physical items', async () => {
    await service.settleSuccess(TRANSACTION_ID);

    // stockQuantity + reservedQuantity, for the paperback only.
    expect(manager.decrement).toHaveBeenCalledTimes(2);
    expect(manager.decrement).toHaveBeenCalledWith(expect.anything(), { id: 101 }, 'stockQuantity', 2);
    expect(manager.decrement).toHaveBeenCalledWith(expect.anything(), { id: 101 }, 'reservedQuantity', 2);
  });

  /**
   * The physical mirror of the digital-delivery block above.
   *
   * Before this existed, `fulfillment_status` had exactly two writers in the
   * whole codebase — the entity default and `cancelOrder` — so a paid printed
   * book sat on NOT_STARTED forever: invisible to any admin queue, and with no
   * message ever sent to the buyer.
   */
  describe('physical fulfilment', () => {
    /** Restrict the fixture order to physical lines only. */
    const physicalOnlyOrder = () => {
      manager.findOne.mockImplementation((entity: any, options: any) => {
        if (entity === Transaction) {
          if (options?.select) {
            return Promise.resolve({ id: TRANSACTION_ID, status: state.transactionStatus });
          }
          const order = buildOrder();
          order.items = order.items.filter((item: any) => item.id === PHYSICAL_ITEM_ID);
          return Promise.resolve({ id: TRANSACTION_ID, status: state.transactionStatus, raw_response: {}, order });
        }
        if (entity === Order) {
          return Promise.resolve({
            id: ORDER_ID,
            payment_status: state.orderPaymentStatus,
            fulfillment_status: state.orderFulfillmentStatus,
          });
        }
        return Promise.resolve(null);
      });
    };

    it('moves a paid physical order NOT_STARTED -> PROCESSING and confirms it once', async () => {
      const outcome = await service.settleSuccess(TRANSACTION_ID);

      expect(outcome).toBe(SettlementOutcome.PROCESSED);
      expect(state.orderFulfillmentStatus).toBe(FulfillmentStatus.PROCESSING);
      expect(mailService.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);

      const [email, name, orderNumber] = mailService.sendOrderConfirmationEmail.mock.calls[0];
      expect(email).toBe(BUYER_EMAIL);
      expect(name).toBe('Ada');
      expect(orderNumber).toBe('MP-000042');
    });

    it('writes an audit row for the automatic transition', async () => {
      await service.settleSuccess(TRANSACTION_ID);

      expect(statusLogs).toHaveLength(1);
      expect(statusLogs[0]).toMatchObject({
        payment_status: PaymentStatus.PAID,
        fulfillment_status: FulfillmentStatus.PROCESSING,
      });
      // No human made this change, so `changed_by` must stay unset rather than
      // being attributed to whichever user id happened to be nearby.
      expect(statusLogs[0].changed_by).toBeUndefined();
    });

    /**
     * THE regression this hook must never lose, and the exact mirror of the
     * digital "does not email again" test.
     *
     * Settlement is reachable three ways (webhook, reconciliation cron,
     * `verifyOrder` poll) and all three routinely land on the same order. The
     * transaction status gate alone would satisfy this, so the body is forced
     * to re-run: only the NOT_STARTED conditional can stop the second e-mail.
     */
    it('does not confirm again when settlement re-runs its body on an already-queued order', async () => {
      await service.settleSuccess(TRANSACTION_ID);
      expect(mailService.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);

      state.transactionStatus = TransactionStatus.PENDING;
      state.orderPaymentStatus = PaymentStatus.PENDING;
      // `orderFulfillmentStatus` is deliberately NOT rewound — that is the
      // durable state the second settlement must observe.

      await service.settleSuccess(TRANSACTION_ID);

      expect(mailService.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
      expect(statusLogs).toHaveLength(1);
      expect(state.orderFulfillmentStatus).toBe(FulfillmentStatus.PROCESSING);
    });

    /**
     * An admin who ships an order before the reconciliation cron re-settles it
     * must not have their work reset to PROCESSING.
     */
    it('leaves an order an admin has already advanced alone', async () => {
      state.orderFulfillmentStatus = FulfillmentStatus.SHIPPED;

      await service.settleSuccess(TRANSACTION_ID);

      expect(state.orderFulfillmentStatus).toBe(FulfillmentStatus.SHIPPED);
      expect(mailService.sendOrderConfirmationEmail).not.toHaveBeenCalled();
    });

    /**
     * A digital-only order is fully served by the download e-mail. Sending a
     * second "we're preparing your order" for something with nothing to ship
     * would be noise, and would put us closer to spam filters for no gain.
     */
    it('sends no confirmation for a digital-only order', async () => {
      manager.findOne.mockImplementation((entity: any, options: any) => {
        if (entity === Transaction) {
          if (options?.select) {
            return Promise.resolve({ id: TRANSACTION_ID, status: state.transactionStatus });
          }
          const order = buildOrder();
          order.items = order.items.filter((item: any) => item.id === DIGITAL_ITEM_ID);
          return Promise.resolve({ id: TRANSACTION_ID, status: state.transactionStatus, raw_response: {}, order });
        }
        if (entity === Order) {
          return Promise.resolve({
            id: ORDER_ID,
            payment_status: state.orderPaymentStatus,
            fulfillment_status: state.orderFulfillmentStatus,
          });
        }
        return Promise.resolve(null);
      });

      await service.settleSuccess(TRANSACTION_ID);

      expect(mailService.sendOrderConfirmationEmail).not.toHaveBeenCalled();
      // No claim statement should even be issued against the order row.
      expect(manager.update).not.toHaveBeenCalled();
      expect(state.orderFulfillmentStatus).toBe(FulfillmentStatus.NOT_STARTED);
    });

    /**
     * A cancelled-but-paid order needs a refund, not fulfilment. Queueing it
     * would put a dead order in front of an admin to ship.
     */
    it('does not queue fulfilment when payment lands on an already-cancelled order', async () => {
      physicalOnlyOrder();
      state.orderFulfillmentStatus = FulfillmentStatus.CANCELLED;

      const outcome = await service.settleSuccess(TRANSACTION_ID);

      expect(outcome).toBe(SettlementOutcome.REFUND_REQUIRED);
      expect(state.orderFulfillmentStatus).toBe(FulfillmentStatus.CANCELLED);
      expect(mailService.sendOrderConfirmationEmail).not.toHaveBeenCalled();
    });

    /**
     * Razorpay retries non-2xx webhook responses, so a mail outage must not
     * fail a payment we have already recorded.
     */
    it('still settles the payment when the confirmation email fails', async () => {
      physicalOnlyOrder();
      mailService.sendOrderConfirmationEmail.mockRejectedValue(new Error('SMTP unavailable'));

      const outcome = await service.settleSuccess(TRANSACTION_ID);

      expect(outcome).toBe(SettlementOutcome.PROCESSED);
      expect(state.orderPaymentStatus).toBe(PaymentStatus.PAID);
      // The state change is what matters and it survives; only the e-mail is lost.
      expect(state.orderFulfillmentStatus).toBe(FulfillmentStatus.PROCESSING);
    });
  });

  /**
   * The accounting half, and the third peer of digital delivery and physical
   * fulfilment.
   *
   * The difference worth holding on to: those two are per-fulfilment-channel
   * and claim inside the settlement transaction, under the order's write lock.
   * Invoicing is per ORDER and happens entirely AFTER the commit, so its
   * exactly-once guarantee comes from the UNIQUE index on `invoices.order_id`
   * rather than from a conditional UPDATE. The fake store above enforces that
   * index, so these tests exercise the real mechanism.
   */
  describe('invoicing', () => {
    /** The single invoice row in the store, for assertions. */
    const onlyInvoice = (): Invoice => {
      expect(invoices.size).toBe(1);
      return [...invoices.values()][0];
    };

    it('raises exactly one invoice for a mixed order and e-mails it', async () => {
      const outcome = await service.settleSuccess(TRANSACTION_ID);

      expect(outcome).toBe(SettlementOutcome.PROCESSED);

      const invoice = onlyInvoice();
      // One invoice covering BOTH lines, not one per fulfilment channel.
      expect(invoice.hasDigitalItems).toBe(true);
      expect(invoice.hasPhysicalItems).toBe(true);
      expect(invoiceItems).toHaveLength(2);

      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);
      const [email, name, data] = (
        mailService.sendInvoiceEmail.mock.calls as Array<[string, string, InvoiceEmailData]>
      )[0];
      expect(email).toBe(BUYER_EMAIL);
      expect(name).toBe('Ada');
      expect(data.orderNumber).toBe('MP-000042');
    });

    /**
     * The whole point of the feature: the invoice must state what the customer
     * was actually charged, never a recomputation of it.
     */
    it('invoices the order total verbatim, with the inclusive tax as a component', async () => {
      await service.settleSuccess(TRANSACTION_ID);

      const invoice = onlyInvoice();
      expect(invoice.totalAmount).toBe(ORDER_TOTAL);
      expect(invoice.taxAmount).toBe(ORDER_TAX);
      expect(invoice.discountAmount).toBe('0.00');
      // subtotal + tax - discount reproduces the charged total exactly.
      expect(Number(invoice.subtotal) + Number(invoice.taxAmount)).toBeCloseTo(Number(ORDER_TOTAL), 2);
      // The Razorpay reference rides along for reconciliation.
      expect(invoice.gatewayTransactionRef).toBe(GATEWAY_REF);
    });

    /**
     * THE regression this hook must never lose, and the mirror of the digital
     * and physical "does not send again" tests.
     *
     * Settlement is reachable three ways (webhook, reconciliation cron,
     * `verifyOrder` poll) and all three routinely land on the same order. A
     * second invoice would be a second financial document for money that was
     * only taken once. The transaction-status gate alone would satisfy this, so
     * the body is forced to re-run: only the invoice row's existence — and,
     * behind it, the unique index — can stop the second one.
     */
    it('does not invoice again when settlement re-runs its body on an already-invoiced order', async () => {
      await service.settleSuccess(TRANSACTION_ID);
      expect(invoices.size).toBe(1);
      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);

      state.transactionStatus = TransactionStatus.PENDING;
      state.orderPaymentStatus = PaymentStatus.PENDING;

      await service.settleSuccess(TRANSACTION_ID);

      expect(invoices.size).toBe(1);
      expect(invoiceItems).toHaveLength(2);
      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });

    it('does not invoice again when the same transaction is settled twice', async () => {
      const first = await service.settleSuccess(TRANSACTION_ID);
      const second = await service.settleSuccess(TRANSACTION_ID);

      expect(first).toBe(SettlementOutcome.PROCESSED);
      expect(second).toBe(SettlementOutcome.ALREADY_PROCESSED);
      expect(invoices.size).toBe(1);
      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });

    /**
     * A cancelled-but-paid order needs a refund, not paperwork. Issuing an
     * invoice would hand the customer a document for goods we are about to give
     * back.
     */
    it('raises no invoice when payment lands on an already-cancelled order', async () => {
      state.orderFulfillmentStatus = FulfillmentStatus.CANCELLED;

      const outcome = await service.settleSuccess(TRANSACTION_ID);

      expect(outcome).toBe(SettlementOutcome.REFUND_REQUIRED);
      expect(invoices.size).toBe(0);
      expect(mailService.sendInvoiceEmail).not.toHaveBeenCalled();
    });

    /**
     * Invoicing is the least important thing that happens here. A customer who
     * paid must still get their download and their order queued for fulfilment
     * even if the invoice path fails outright, and Razorpay must not be made to
     * redeliver a webhook we handled correctly.
     */
    it('still settles the payment and delivers the download when invoicing fails', async () => {
      manager.create.mockImplementationOnce(() => {
        throw new Error('invoices table missing');
      });

      const outcome = await service.settleSuccess(TRANSACTION_ID);

      expect(outcome).toBe(SettlementOutcome.PROCESSED);
      expect(state.transactionStatus).toBe(TransactionStatus.SUCCESS);
      expect(state.orderPaymentStatus).toBe(PaymentStatus.PAID);
      expect(state.itemDeliveryStatus.get(DIGITAL_ITEM_ID)).toBe(DigitalDeliveryStatus.DELIVERED);
      expect(mailService.sendDigitalDeliveryEmail).toHaveBeenCalledTimes(1);
      expect(invoices.size).toBe(0);
    });

    it('still settles the payment when the invoice e-mail fails', async () => {
      mailService.sendInvoiceEmail.mockRejectedValue(new Error('SMTP unavailable'));

      const outcome = await service.settleSuccess(TRANSACTION_ID);

      expect(outcome).toBe(SettlementOutcome.PROCESSED);
      // The accounting record survives; only the e-mail is lost.
      expect(onlyInvoice().issuedAt).toBeNull();
    });

    /**
     * Invoicing is per order, not per delivery channel, so an order with
     * nothing to e-mail still gets an invoice — and that invoice e-mail is the
     * only mail a physical-only buyer receives beyond their confirmation.
     */
    it('invoices a physical-only order too', async () => {
      manager.findOne.mockImplementation((entity: any, options: any) => {
        if (entity === Transaction) {
          if (options?.select) {
            return Promise.resolve({ id: TRANSACTION_ID, status: state.transactionStatus });
          }
          const order = buildOrder();
          order.items = order.items.filter((item: any) => item.id === PHYSICAL_ITEM_ID);
          return Promise.resolve({
            id: TRANSACTION_ID,
            status: state.transactionStatus,
            gateway_ref_id: GATEWAY_REF,
            raw_response: {},
            order,
          });
        }
        if (entity === Order) {
          return Promise.resolve({
            id: ORDER_ID,
            payment_status: state.orderPaymentStatus,
            fulfillment_status: state.orderFulfillmentStatus,
          });
        }
        return Promise.resolve(null);
      });

      await service.settleSuccess(TRANSACTION_ID);

      expect(mailService.sendDigitalDeliveryEmail).not.toHaveBeenCalled();
      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);
      expect(invoices.size).toBe(1);
    });
  });
});
