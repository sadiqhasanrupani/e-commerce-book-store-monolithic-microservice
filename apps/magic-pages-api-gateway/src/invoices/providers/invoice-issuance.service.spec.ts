import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { Invoice } from '@app/contract/invoices/entities/invoice.entity';
import { InvoiceItem } from '@app/contract/invoices/entities/invoice-item.entity';
import { InvoiceItemType } from '@app/contract/invoices/enums/invoice-item-type.enum';
import { InvoiceStatus } from '@app/contract/invoices/enums/invoice-status.enum';
import { Order } from '@app/contract/orders/entities/order.entity';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { InvoiceEmailData } from '@app/contract/mail/interfaces/invoice-email.interface';

import { InvoiceIssuanceService } from './invoice-issuance.service';
import { InvoiceNumberProvider } from './invoice-number.provider';
import { MailService } from '../../mail/mail.service';

const ORDER_ID = 42;
const BUYER_EMAIL = 'buyer@example.com';

/**
 * The money fixture, and the reason every number below is spelled out.
 *
 * Tax at Magic Pages is INCLUSIVE, so these are components of the total, never
 * additions to it:
 *
 *   ebook      250.00 x 2 = 500.00, 18% inclusive -> 500 * 18/118 =  76.27 tax
 *   paperback  300.00 x 1 = 300.00,  5% inclusive -> 300 *  5/105 =  14.29 tax
 *   items                  = 800.00
 *   shipping               =  50.00
 *   total_amount           = 850.00   <- what the customer was actually charged
 *   tax_amount             =  90.56   <- already inside the 850.00
 *   => invoice subtotal    = 759.44   (850.00 - 90.56, so subtotal + tax = total)
 *
 * If any assertion on these ever has to be "fixed" by changing the expected
 * total, something has started recomputing money instead of copying it.
 */
const ITEMS_TOTAL = '800.00';
const SHIPPING = '50.00';
const ORDER_TOTAL = '850.00';
const ORDER_TAX = '90.56';
const INVOICE_SUBTOTAL = '759.44';

const DIGITAL_ITEM_ID = 10;
const PHYSICAL_ITEM_ID = 11;

/**
 * The order the service reads back after settlement commits.
 *
 * Typed to the RUNTIME shape rather than to `Order`, deliberately: pg hands
 * `numeric` columns back as strings while the entity declares them `number`,
 * and coping with that is part of what the service is being tested on. A
 * fixture typed as `Order` would quietly hide it behind number literals.
 */
interface OrderFixture {
  id: number;
  currency: string;
  total_amount: string;
  tax_amount: string;
  shipping_cost: string;
  shipping_address: Record<string, string> | null;
  user: { id: number; email: string; firstName: string; lastName: string } | null;
  items: Array<{
    id: number;
    quantity: number;
    unit_price: string;
    total_price: string;
    tax_percentage: string | null;
    tax_amount: string;
    bookFormatVariant: {
      id: number;
      format: BookFormat;
      isbn: string | null;
      fileUrl?: string;
      book: { title: string };
    } | null;
  }>;
}

/**
 * Invoicing on payment settlement.
 *
 * The database and SMTP are the only things faked. The invoice store below
 * enforces the UNIQUE constraint on `order_id` exactly as Postgres does
 * (`23505` on a duplicate), because that constraint — not any application
 * check — is what makes this feature exactly-once, and a fake that let a second
 * row through would make the idempotency tests meaningless.
 */
describe('InvoiceIssuanceService', () => {
  let service: InvoiceIssuanceService;
  let mailService: { sendInvoiceEmail: jest.Mock };

  /**
   * `invoices` rows, keyed by id, typed as the entity so every assertion below
   * is checked against the real column set rather than against `any`. The
   * unique index is modelled on `orderId`.
   */
  let invoices: Map<string, Invoice>;
  /** `invoice_items` rows. */
  let invoiceItems: InvoiceItem[];
  /** `invoice_daily_counters.counter` for today. */
  let counter: number;
  /** Set true to make the pre-insert existence check miss, i.e. simulate a race. */
  let hideExistingInvoice: boolean;

  let orderRow: OrderFixture;
  let nextInvoiceId: number;

  const buildOrder = (): OrderFixture => ({
    id: ORDER_ID,
    currency: 'INR',
    total_amount: ORDER_TOTAL,
    tax_amount: ORDER_TAX,
    shipping_cost: SHIPPING,
    shipping_address: {
      line1: '12, MG Road',
      line2: 'Apartment 4B',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400001',
      country: 'IN',
      phone: '+91-9876543210',
    },
    user: { id: 7, email: BUYER_EMAIL, firstName: 'Ada', lastName: 'Lovelace' },
    items: [
      {
        id: DIGITAL_ITEM_ID,
        quantity: 2,
        unit_price: '250.00',
        total_price: '500.00',
        tax_percentage: '18.00',
        tax_amount: '76.27',
        bookFormatVariant: {
          id: 100,
          format: BookFormat.EBOOK,
          isbn: null,
          fileUrl: 'http://minio:9000/bucket/books/the-book.pdf',
          book: { title: 'The Digital Book' },
        },
      },
      {
        id: PHYSICAL_ITEM_ID,
        quantity: 1,
        unit_price: '300.00',
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

  /** Stands in for the invoice-creation transaction's EntityManager. */
  const manager = {
    create: jest.fn((_entity: unknown, plain: object) => ({ ...plain })),
    save: jest.fn((entity: unknown, value: unknown) => {
      if (entity === Invoice) {
        const row = value as Invoice;

        // The UNIQUE index on `order_id`, modelled faithfully.
        const clash = [...invoices.values()].some((existing) => existing.orderId === row.orderId);
        if (clash) {
          return Promise.reject(Object.assign(new Error('duplicate key value'), { code: '23505' }));
        }

        const saved: Invoice = { ...row, id: `invoice-${nextInvoiceId++}` };
        invoices.set(saved.id, saved);
        return Promise.resolve(saved);
      }

      if (entity === InvoiceItem) {
        const rows = (Array.isArray(value) ? value : [value]) as InvoiceItem[];
        invoiceItems.push(...rows);
        return Promise.resolve(rows);
      }

      return Promise.resolve(value);
    }),
  };

  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    isTransactionActive: true,
    manager,
    // Backs InvoiceNumberProvider's atomic daily-counter upsert.
    query: jest.fn(() => Promise.resolve([{ counter: ++counter }])),
  };

  const invoiceRepository = {
    findOne: jest.fn(({ where }: { where: { orderId: number } }) => {
      if (hideExistingInvoice) return Promise.resolve(null);
      const found = [...invoices.values()].find((row) => row.orderId === where.orderId);
      return Promise.resolve(found ?? null);
    }),
    update: jest.fn((id: string, values: Partial<Invoice>) => {
      const row = invoices.get(id);
      if (row) Object.assign(row, values);
      return Promise.resolve({ affected: row ? 1 : 0 });
    }),
  };

  const orderRepository = {
    findOne: jest.fn((): Promise<OrderFixture | null> => Promise.resolve(orderRow)),
  };

  const dataSource = {
    createQueryRunner: jest.fn(() => queryRunner),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Order) return orderRepository;
      if (entity === Invoice) return invoiceRepository;
      return {};
    }),
  };

  const claim = { orderId: ORDER_ID, claimed: true, gatewayRef: 'pay_QwErTy12345' };

  /** The single invoice row in the store, for assertions. */
  const onlyInvoice = (): Invoice => {
    expect(invoices.size).toBe(1);
    return [...invoices.values()][0];
  };

  const emailData = (call = 0): InvoiceEmailData =>
    (mailService.sendInvoiceEmail.mock.calls as Array<[string, string, InvoiceEmailData]>)[call][2];

  beforeEach(async () => {
    jest.clearAllMocks();

    invoices = new Map();
    invoiceItems = [];
    counter = 0;
    nextInvoiceId = 1;
    hideExistingInvoice = false;
    orderRow = buildOrder();

    mailService = { sendInvoiceEmail: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceIssuanceService,
        // Not mocked: invoice numbering must go through the real provider, so
        // the format and the counter's atomic upsert are exercised here.
        InvoiceNumberProvider,
        { provide: DataSource, useValue: dataSource },
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: { get: () => 'https://storefront.test' } },
      ],
    }).compile();

    service = module.get<InvoiceIssuanceService>(InvoiceIssuanceService);
  });

  describe('claimForOrder', () => {
    /**
     * The in-transaction half runs while settlement holds the order's write
     * lock. Any query it issued could abort that transaction on failure, taking
     * a payment we have already taken down with it — so it must issue none.
     */
    it('touches no database', () => {
      const result = service.claimForOrder({ id: ORDER_ID } as Order, 'pay_abc');

      expect(result).toEqual({ orderId: ORDER_ID, claimed: true, gatewayRef: 'pay_abc' });
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('normalises a missing gateway reference to null', () => {
      expect(service.claimForOrder({ id: ORDER_ID } as Order, null).gatewayRef).toBeNull();
    });
  });

  describe('dispatchClaim — the invoice row', () => {
    it('copies the order totals verbatim instead of recomputing them', async () => {
      await service.dispatchClaim(claim);

      const invoice = onlyInvoice();

      // The single most important assertion in this file: the invoice total is
      // exactly what the customer was charged.
      expect(invoice.totalAmount).toBe(ORDER_TOTAL);
      expect(invoice.taxAmount).toBe(ORDER_TAX);
      expect(invoice.discountAmount).toBe('0.00');
      // subtotal + tax - discount must reproduce the total.
      expect(invoice.subtotal).toBe(INVOICE_SUBTOTAL);
      expect(Number(invoice.subtotal) + Number(invoice.taxAmount) - Number(invoice.discountAmount)).toBeCloseTo(
        Number(ORDER_TOTAL),
        2,
      );
      expect(invoice.currency).toBe('INR');
      expect(invoice.orderId).toBe(ORDER_ID);
      expect(invoice.userId).toBe(7);
      expect(invoice.gatewayTransactionRef).toBe('pay_QwErTy12345');
    });

    it('records the invoice as PAID and dated, with no due date', async () => {
      await service.dispatchClaim(claim);

      const invoice = onlyInvoice();
      expect(invoice.status).toBe(InvoiceStatus.PAID);
      expect(invoice.dueDate).toBeNull();
      expect(invoice.paidAt).toBeInstanceOf(Date);
      expect(invoice.invoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('numbers the invoice through InvoiceNumberProvider', async () => {
      await service.dispatchClaim(claim);

      expect(onlyInvoice().invoiceNumber).toMatch(/^INV-\d{8}-0001$/);
    });

    /**
     * A mixed basket is ONE order and therefore ONE invoice, not one per
     * fulfilment channel.
     */
    it('raises a single invoice covering both the digital and the physical line', async () => {
      await service.dispatchClaim(claim);

      const invoice = onlyInvoice();
      expect(invoice.hasDigitalItems).toBe(true);
      expect(invoice.hasPhysicalItems).toBe(true);
      expect(invoiceItems).toHaveLength(2);
      expect(invoiceItems.every((item) => item.invoiceId === invoice.id)).toBe(true);
    });

    it('mirrors each order line, including its recorded tax snapshot', async () => {
      await service.dispatchClaim(claim);

      const digital = invoiceItems.find((item) => item.orderItemId === DIGITAL_ITEM_ID);
      expect(digital).toMatchObject({
        itemType: InvoiceItemType.INTANGIBLE,
        title: 'The Digital Book',
        format: BookFormat.EBOOK,
        quantity: 2,
        unitPrice: '250.00',
        totalPrice: '500.00',
        taxRate: '18.00',
        taxAmount: '76.27',
        requiresShipping: false,
        sku: null,
        bookFormatVariantId: 100,
      });

      const physical = invoiceItems.find((item) => item.orderItemId === PHYSICAL_ITEM_ID);
      expect(physical).toMatchObject({
        itemType: InvoiceItemType.TANGIBLE,
        title: 'A Paperback',
        format: BookFormat.PAPERBACK,
        quantity: 1,
        unitPrice: '300.00',
        totalPrice: '300.00',
        taxRate: '5.00',
        taxAmount: '14.29',
        requiresShipping: true,
        sku: '978-3-16-148410-0',
      });
    });

    /**
     * Book files are uploaded `public-read`. Snapshotting `variant.fileUrl`
     * onto an invoice would put a permanent, unauthenticated, forwardable copy
     * of a paid product into the buyer's mailbox and into our database.
     */
    it('never snapshots the raw object-storage file URL onto a line', async () => {
      await service.dispatchClaim(claim);

      expect(invoiceItems.every((item) => item.fileDeliveryUrl === null)).toBe(true);
      expect(JSON.stringify(invoiceItems)).not.toContain('minio');
    });

    it('snapshots the order address as the shipping and billing address', async () => {
      await service.dispatchClaim(claim);

      const invoice = onlyInvoice();
      // `orders.shipping_address` stores no name, so the buyer's supplies it.
      expect(invoice.shippingAddress).toEqual({
        fullName: 'Ada Lovelace',
        addressLine1: '12, MG Road',
        addressLine2: 'Apartment 4B',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'IN',
        phone: '+91-9876543210',
      });
      expect(invoice.billingAddress).toMatchObject({ fullName: 'Ada Lovelace', email: BUYER_EMAIL });
    });
  });

  describe('dispatchClaim — the e-mail', () => {
    it('sends the invoice to the address on the order', async () => {
      await service.dispatchClaim(claim);

      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);
      const [email, name] = (mailService.sendInvoiceEmail.mock.calls as Array<[string, string, InvoiceEmailData]>)[0];
      expect(email).toBe(BUYER_EMAIL);
      expect(name).toBe('Ada');
    });

    it('shows the customer the breakdown they were actually charged', async () => {
      await service.dispatchClaim(claim);

      const data = emailData();
      expect(data.grandTotal).toBe(ORDER_TOTAL);
      expect(data.itemsTotal).toBe(ITEMS_TOTAL);
      expect(data.shippingTotal).toBe(SHIPPING);
      expect(data.taxTotal).toBe(ORDER_TAX);
      // items + shipping must reconcile with the total the customer paid.
      expect(Number(data.itemsTotal) + Number(data.shippingTotal)).toBeCloseTo(Number(data.grandTotal), 2);
      expect(data.orderNumber).toBe('MP-000042');
      expect(data.orderUrl).toBe('https://storefront.test/orders?order=42');
      expect(data.lines).toHaveLength(2);
    });

    /**
     * `order_items.tax_percentage` is nullable on purpose: NULL means "this
     * line was never taxed", which is distinct from a stored 0. The e-mail is
     * the one place that distinction can still be shown, because the invoice
     * column is NOT NULL DEFAULT 0.
     */
    it('preserves the untaxed/zero-rated distinction in the e-mail', async () => {
      orderRow.items[0].tax_percentage = null;
      orderRow.items[0].tax_amount = '0.00';

      await service.dispatchClaim(claim);

      const lines = emailData().lines;
      expect(lines[0].taxRate).toBeNull();
      expect(lines[1].taxRate).toBe('5.00');
    });

    it('stamps issuedAt only once the e-mail has gone out', async () => {
      await service.dispatchClaim(claim);

      const invoice = onlyInvoice();
      expect(invoiceRepository.update).toHaveBeenCalledWith(invoice.id, { issuedAt: expect.any(Date) as Date });
      expect(invoice.issuedAt).toBeInstanceOf(Date);
    });
  });

  describe('idempotency', () => {
    /**
     * THE regression this feature must never lose.
     *
     * Settlement is reachable three ways (Razorpay webhook, reconciliation
     * cron, the storefront's `verifyOrder` poll) and all three routinely land
     * on the same order. A second invoice would be a second financial document
     * for money that was only taken once.
     */
    it('raises one invoice and sends one e-mail when dispatched twice', async () => {
      await service.dispatchClaim(claim);
      await service.dispatchClaim(claim);

      expect(invoices.size).toBe(1);
      expect(invoiceItems).toHaveLength(2);
      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });

    /**
     * Belt and braces for the same guarantee, one layer lower.
     *
     * The test above is satisfied by the pre-insert existence check alone, so
     * it would still pass if the UNIQUE index were dropped. Here the check is
     * forced to miss — exactly what a genuine race produces — so only the
     * database constraint can stop the second invoice.
     */
    it('raises no second invoice when the existence check loses a race with the unique index', async () => {
      await service.dispatchClaim(claim);
      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);

      hideExistingInvoice = true;

      await expect(service.dispatchClaim(claim)).resolves.toBeUndefined();

      expect(invoices.size).toBe(1);
      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);
      // The half-written invoice is rolled back rather than left behind.
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('does nothing at all for an unclaimed order', async () => {
      await service.dispatchClaim({ orderId: ORDER_ID, claimed: false, gatewayRef: null });

      expect(invoices.size).toBe(0);
      expect(mailService.sendInvoiceEmail).not.toHaveBeenCalled();
      // Not even a database read: nothing to do is decided before the query.
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });
  });

  describe('failure isolation', () => {
    /**
     * A customer who paid must still get their download and their order queued
     * for fulfilment even if invoicing fails outright. Settlement calls this
     * after committing and does not guard the call, so "never throws" is the
     * contract, not a nicety.
     */
    it('never throws when the mail transport is down, and keeps the invoice row', async () => {
      mailService.sendInvoiceEmail.mockRejectedValue(new Error('SMTP unavailable'));

      await expect(service.dispatchClaim(claim)).resolves.toBeUndefined();

      // The accounting record survives; only the e-mail is lost, and the NULL
      // issuedAt is what says so.
      const invoice = onlyInvoice();
      expect(invoice.issuedAt).toBeNull();
      expect(invoiceRepository.update).not.toHaveBeenCalled();
    });

    it('never throws when the invoice row cannot be written', async () => {
      manager.save.mockRejectedValueOnce(new Error('deadlock detected'));

      await expect(service.dispatchClaim(claim)).resolves.toBeUndefined();

      expect(invoices.size).toBe(0);
      expect(mailService.sendInvoiceEmail).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('never throws when invoice numbering fails', async () => {
      queryRunner.query.mockRejectedValueOnce(new Error('counter table missing'));

      await expect(service.dispatchClaim(claim)).resolves.toBeUndefined();

      expect(invoices.size).toBe(0);
      expect(mailService.sendInvoiceEmail).not.toHaveBeenCalled();
    });

    it('never throws when the order has disappeared', async () => {
      orderRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.dispatchClaim(claim)).resolves.toBeUndefined();
      expect(invoices.size).toBe(0);
    });

    /** `invoices.user_id` is NOT NULL, and an invoice with no buyer is unusable. */
    it('raises nothing when the order has no user', async () => {
      orderRow.user = null;

      await expect(service.dispatchClaim(claim)).resolves.toBeUndefined();
      expect(invoices.size).toBe(0);
      expect(mailService.sendInvoiceEmail).not.toHaveBeenCalled();
    });
  });

  describe('order shapes', () => {
    it('invoices a digital-only order with no shipping and no address', async () => {
      orderRow.items = [orderRow.items[0]];
      orderRow.shipping_address = null;
      orderRow.shipping_cost = '0.00';
      orderRow.total_amount = '500.00';
      orderRow.tax_amount = '76.27';

      await service.dispatchClaim(claim);

      const invoice = onlyInvoice();
      expect(invoice.hasDigitalItems).toBe(true);
      expect(invoice.hasPhysicalItems).toBe(false);
      expect(invoice.shippingAddress).toBeNull();
      expect(invoice.totalAmount).toBe('500.00');
      expect(invoice.subtotal).toBe('423.73');
      expect(emailData().shippingTotal).toBe('0.00');
    });

    /**
     * Invoicing is per ORDER, not per delivery channel, so a printed-book-only
     * order is invoiced and e-mailed exactly like a digital one.
     */
    it('invoices a physical-only order', async () => {
      orderRow.items = [orderRow.items[1]];
      orderRow.total_amount = '350.00';
      orderRow.tax_amount = '14.29';

      await service.dispatchClaim(claim);

      const invoice = onlyInvoice();
      expect(invoice.hasPhysicalItems).toBe(true);
      expect(invoice.hasDigitalItems).toBe(false);
      expect(invoice.totalAmount).toBe('350.00');
      expect(mailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });

    /**
     * A line whose variant row is gone cannot be given a `format`, which is a
     * NOT NULL enum. Omitting it is the only truthful option, and the total
     * still reflects what was charged.
     */
    it('omits a line with no variant but still invoices the recorded total', async () => {
      orderRow.items[0].bookFormatVariant = null;

      await service.dispatchClaim(claim);

      expect(invoiceItems).toHaveLength(1);
      expect(onlyInvoice().totalAmount).toBe(ORDER_TOTAL);
    });
  });
});
