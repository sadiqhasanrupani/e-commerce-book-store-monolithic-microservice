import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryRunner } from 'typeorm';

import {
  BillingAddressSnapshot,
  Invoice,
  ShippingAddressSnapshot as InvoiceShippingAddressSnapshot,
} from '@app/contract/invoices/entities/invoice.entity';
import { InvoiceItem } from '@app/contract/invoices/entities/invoice-item.entity';
import { InvoiceItemType } from '@app/contract/invoices/enums/invoice-item-type.enum';
import { InvoiceStatus } from '@app/contract/invoices/enums/invoice-status.enum';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { InvoiceEmailData, InvoiceEmailLine } from '@app/contract/mail/interfaces/invoice-email.interface';

import { MailService } from '../../mail/mail.service';
import { InvoiceNumberProvider } from './invoice-number.provider';

/**
 * What one settlement decided about invoicing, handed from the in-transaction
 * step to the post-commit step.
 *
 * `claimed` is true only for the settlement call that actually moved the order
 * to PAID. Every later re-settlement (a redelivered webhook, the reconciliation
 * cron, the storefront's `verifyOrder` poll) produces `claimed: false` and does
 * nothing.
 */
export interface InvoiceIssuanceClaim {
  orderId: number;
  claimed: boolean;
  /** Razorpay reference from the settled transaction, stored for reconciliation. */
  gatewayRef: string | null;
}

/** Storefront route used when `FRONTEND_URL` is unset — matches CheckoutService's fallback. */
const FRONTEND_URL_FALLBACK = 'http://localhost:5173';

/** Postgres `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505';

/** Round to the 2 decimal places every `numeric(10,2)` money column stores. */
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** `numeric` columns arrive from pg as strings; normalise without ever inventing a value. */
const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: number): string => round2(value).toFixed(2);

/**
 * Raises the invoice for a paid order and e-mails it to the buyer.
 *
 * ## Where this sits
 *
 * It is the third peer of `DigitalDeliveryService` and
 * `PhysicalFulfillmentService`: all three are driven from
 * `PaymentSettlementService`, and all three follow the same two-phase shape —
 * decide inside the settlement transaction, act after it commits, never throw
 * back into settlement.
 *
 * An invoice is a property of an ORDER, not of a delivery event, so it is
 * raised once per paid order regardless of what the order contains. A mixed
 * basket (an ebook beside a paperback) therefore produces exactly ONE invoice
 * covering both lines, rather than one per fulfilment channel.
 *
 * ## Why nothing happens inside the settlement transaction
 *
 * The other two services claim with a conditional UPDATE inside the
 * transaction, because they are gating a column on a row settlement already
 * holds a lock on. This one cannot use that trick safely: any statement issued
 * against `invoices` inside the settlement transaction — even a plain SELECT —
 * aborts the whole transaction if it errors, which would let an invoicing
 * problem roll back a payment we have already taken. A customer who paid must
 * get their download even if invoicing fails outright.
 *
 * So the in-transaction half (`claimForOrder`) touches no database at all. It
 * reads a fact settlement already knows — "this call is the one that moved the
 * order to PAID" — and everything else happens after the commit, wrapped so no
 * failure can escape.
 *
 * ## Exactly-once
 *
 * Two layers, in order of authority:
 *
 *  1. **`invoices.order_id` is UNIQUE** (see
 *     `1765600100000-AddUniqueOrderIdToInvoices`). This is the real guarantee.
 *     Nothing — a redelivered webhook, a re-driven settlement, two processes
 *     racing — can put a second invoice on an order, because the database
 *     refuses it. A `23505` here is treated as "someone else already invoiced
 *     this order", not as an error.
 *  2. An existence check before the insert, which turns the ordinary repeat
 *     case into a cheap SELECT instead of a burnt invoice number.
 *
 * The e-mail is chained to the INSERT: it is sent only by the call that
 * actually created the row. That is what stops a duplicate invoice e-mail, and
 * it is the same reasoning as `PhysicalFulfillmentClaim.claimed` gating the
 * confirmation e-mail.
 *
 * ## Money
 *
 * Nothing here is recomputed. `orders.total_amount` is copied verbatim onto
 * `invoices.totalAmount`, `orders.tax_amount` onto `invoices.taxAmount`, and
 * each line's `unit_price` / `total_price` / `tax_percentage` / `tax_amount`
 * onto the matching invoice line. An invoice whose total disagrees with what
 * the customer was charged is the worst possible outcome for this feature, so
 * the only figure that is derived at all is `subtotal`, and it is derived by
 * SUBTRACTION (`total − tax`) precisely so that the entity's documented
 * identity `subtotal + tax − discount = total` reproduces `total_amount`
 * exactly. See `buildInvoiceRow` for the full note.
 */
@Injectable()
export class InvoiceIssuanceService {
  private readonly logger = new Logger(InvoiceIssuanceService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly invoiceNumberProvider: InvoiceNumberProvider,
  ) {}

  /**
   * Decide whether this settlement owes the buyer an invoice.
   *
   * Called INSIDE the settlement transaction, but deliberately does no database
   * work — see the class note. It is synchronous for exactly that reason: there
   * is nothing to await, and keeping it so makes it impossible for a future
   * edit to slip a query in here without noticing what that would mean.
   *
   * @param order the order settlement has just moved to PAID
   * @param gatewayRef `transaction.gateway_ref_id` of the settled payment
   */
  claimForOrder(order: Order, gatewayRef: string | null): InvoiceIssuanceClaim {
    return { orderId: order.id, claimed: true, gatewayRef: gatewayRef ?? null };
  }

  /**
   * Create the invoice row and e-mail it.
   *
   * MUST be called only after the settlement transaction has committed.
   *
   * Never throws. It runs from the webhook / reconciliation cron / verifyOrder
   * paths where the payment is already recorded; turning an invoicing problem
   * into a 500 would make Razorpay redeliver a webhook we handled correctly and
   * would fail the storefront's poll on a genuinely paid order. Worse, it would
   * do so on the least important part of the flow: the buyer's download and the
   * fulfilment queue both matter more than the invoice, and both have already
   * happened by the time we get here.
   */
  async dispatchClaim(claim: InvoiceIssuanceClaim): Promise<void> {
    if (!claim.claimed) {
      return;
    }

    try {
      // Re-read in a fresh query: settlement's entity graph does not carry
      // `items.bookFormatVariant.book`, and its copy is stale now that the
      // transaction has committed.
      const order = await this.dataSource.getRepository(Order).findOne({
        where: { id: claim.orderId },
        relations: ['user', 'items', 'items.bookFormatVariant', 'items.bookFormatVariant.book'],
      });

      if (!order) {
        this.logger.error(`Invoice not raised — order ${claim.orderId} disappeared after settlement`);
        return;
      }

      if (!order.user) {
        // `invoices.user_id` is NOT NULL, and an invoice with no buyer is not a
        // document anyone can use. Same call `InvoicesService.create` makes.
        this.logger.error(`Invoice not raised for order ${order.id} — the order has no associated user`);
        return;
      }

      const invoice = await this.createInvoice(order, claim.gatewayRef);

      if (!invoice) {
        // The normal repeat case: this order was already invoiced. No row, and
        // deliberately no second e-mail.
        this.logger.log(`Order ${order.id} is already invoiced — nothing raised, nothing sent`);
        return;
      }

      await this.emailInvoice(order, invoice);
    } catch (error) {
      this.logger.error(
        `Invoice issuance failed for order ${claim.orderId} — the payment stands`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Persist the invoice header, its lines and its number in one transaction.
   *
   * Its OWN transaction, not settlement's: this runs after settlement has
   * committed, so a failure here rolls back only the half-written invoice.
   *
   * @returns the created invoice, or `null` when the order already had one —
   *          either found by the pre-check or reported by the unique index
   */
  private async createInvoice(order: Order, gatewayRef: string | null): Promise<Invoice | null> {
    // Fast path for the ordinary repeat (a re-driven settlement, a retried
    // dispatch). Not the guarantee — the unique index below is — but it keeps
    // the common case from burning an invoice number on a doomed INSERT.
    const existing = await this.dataSource.getRepository(Invoice).findOne({
      where: { orderId: order.id },
      select: { id: true, invoiceNumber: true },
    });

    if (existing) {
      return null;
    }

    const queryRunner: QueryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // The ONLY invoice-numbering scheme. `generate` must run inside a
      // transaction so a failed insert rolls the daily counter back with it.
      const invoiceNumber = await this.invoiceNumberProvider.generate(queryRunner);

      const { header, lines } = this.buildInvoiceRow(order, invoiceNumber, gatewayRef);

      const invoice = queryRunner.manager.create(Invoice, header);
      const savedInvoice = await queryRunner.manager.save(Invoice, invoice);

      if (lines.length > 0) {
        await queryRunner.manager.save(
          InvoiceItem,
          lines.map((line) => queryRunner.manager.create(InvoiceItem, { ...line, invoiceId: savedInvoice.id })),
        );
      }

      await queryRunner.commitTransaction();

      this.logger.log(`Invoice ${savedInvoice.invoiceNumber} raised for order ${order.id}`);

      return savedInvoice;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      if (isUniqueViolation(error)) {
        // Another process invoiced this order between our pre-check and this
        // INSERT. The database did its job; this is the outcome we want, not an
        // error. The only cost is a skipped invoice number, which is why the
        // pre-check exists.
        this.logger.log(`Order ${order.id} was invoiced concurrently — this call raised nothing`);
        return null;
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Map the recorded order onto invoice columns.
   *
   * ## The money rules, in one place
   *
   * `orders.total_amount` is `Σ(unit_price × quantity) + shipping_cost` in
   * MAJOR units. `shipping_cost` and `tax_amount` are both components ALREADY
   * INSIDE it — tax at Magic Pages is INCLUSIVE (`TaxService` computes it as
   * `P × r / (100 + r)`), so it is never added on top.
   *
   * The `Invoice` entity, however, documents the usual EXCLUSIVE model
   * (`totalAmount = subtotal + taxAmount − discountAmount`) and has no shipping
   * column. Reconciling the two forces one choice, and the invariant that wins
   * is **`invoice.totalAmount` must equal `orders.total_amount` exactly** — a
   * customer must never receive a document that disagrees with their card
   * statement. So:
   *
   *  - `totalAmount` ← `orders.total_amount`, verbatim.
   *  - `taxAmount`   ← `orders.tax_amount`, verbatim (the tax contained in it).
   *  - `discountAmount` ← 0. Nothing in the codebase writes a discount onto an
   *    order; `orders.gift_card_amount` exists but has no writer, and
   *    `total_amount` is not net of it, so mapping it here would silently
   *    misstate the total the moment someone starts using it.
   *  - `subtotal`    ← `total_amount − tax_amount`. Derived by subtraction from
   *    two recorded figures rather than recomputed from prices, so the identity
   *    above reproduces `total_amount` to the paisa. It reads as "net of tax,
   *    shipping included", which is noted on the row itself (`notes`) because
   *    there is no shipping column to say it structurally.
   *
   * Consequence worth knowing: the invoice LINES are tax-inclusive gross
   * amounts (copied from `order_items.total_price`), so they sum to
   * `total_amount − shipping_cost`, not to `subtotal`. The e-mail therefore
   * renders the real breakdown — lines, shipping, total, "includes tax of X" —
   * rather than the header columns, so no human is ever shown the mismatch.
   * `taxRate` on the header stays 0 for the same reason: a basket can mix rates
   * (an 18% paperback beside a 5% workbook) and a single header rate would be a
   * fabrication. The per-line rates carry the truth.
   */
  private buildInvoiceRow(
    order: Order,
    invoiceNumber: string,
    gatewayRef: string | null,
  ): { header: Partial<Invoice>; lines: Array<Partial<InvoiceItem>> } {
    const total = num(order.total_amount);
    const taxTotal = num(order.tax_amount);
    const shipping = num(order.shipping_cost);
    const subtotal = round2(total - taxTotal);
    const currency = order.currency || 'INR';

    const lines: Array<Partial<InvoiceItem>> = [];
    let hasPhysicalItems = false;
    let hasDigitalItems = false;
    let itemsTotal = 0;

    for (const item of order.items ?? []) {
      const variant = item.bookFormatVariant;

      if (!variant) {
        // `invoice_items.format` is a NOT NULL enum and there is nothing
        // truthful to put in it without the variant. Skip rather than guess;
        // the reconciliation check below will flag the resulting gap.
        this.logger.error(
          `Order ${order.id} line ${item.id} has no book format variant — omitted from invoice ${invoiceNumber}`,
        );
        continue;
      }

      const physical = isPhysicalFormat(variant.format);
      hasPhysicalItems ||= physical;
      hasDigitalItems ||= !physical;

      const lineTotal = lineTotalOf(item);
      itemsTotal += lineTotal;

      lines.push({
        orderItemId: item.id,
        bookFormatVariantId: variant.id,
        itemType: physical ? InvoiceItemType.TANGIBLE : InvoiceItemType.INTANGIBLE,
        title: variant.book?.title ?? 'Your purchase',
        format: variant.format,
        // ISBN is a physical-traceability field; a digital line has none.
        sku: physical ? (variant.isbn ?? null) : null,
        // Deliberately NULL, never `variant.fileUrl`. Book files are uploaded
        // `public-read`, so snapshotting that URL onto an invoice would put a
        // permanent, unauthenticated, forwardable copy of a paid product into
        // the buyer's mailbox and into our database. The download stays behind
        // the bearer-authed, ownership-checked order endpoint.
        fileDeliveryUrl: null,
        requiresShipping: physical,
        quantity: item.quantity,
        unitPrice: money(num(item.unit_price)),
        totalPrice: money(lineTotal),
        // NULL rate means "this line was never taxed", which the column cannot
        // express (it is NOT NULL DEFAULT 0). The distinction survives on
        // `order_items.tax_percentage`, and the e-mail renders it faithfully.
        taxRate: money(num(item.tax_percentage ?? 0)),
        taxAmount: money(num(item.tax_amount)),
        discountAmount: money(0),
      });
    }

    // Not a correction — a smoke alarm. If the lines plus shipping do not add
    // up to what we are about to print as the total, the order data itself is
    // inconsistent and someone needs to look. The printed total is still
    // `total_amount`, because that is what the customer actually paid.
    if (round2(itemsTotal + shipping) !== round2(total)) {
      this.logger.error(
        `Order ${order.id}: invoice ${invoiceNumber} lines (${money(itemsTotal)}) + shipping (${money(shipping)}) ` +
          `do not reconcile with total_amount (${money(total)}) — invoicing the recorded total regardless`,
      );
    }

    const buyerName = buildBuyerName(order);
    const shippingAddress = toInvoiceShippingSnapshot(order, buyerName);
    const issuedAt = new Date();

    const header: Partial<Invoice> = {
      invoiceNumber,
      orderId: order.id,
      userId: order.user.id,
      // The money is already in — settlement only claims after `payment_status`
      // becomes PAID — so DRAFT would understate the document from birth.
      status: InvoiceStatus.PAID,
      invoiceDate: issuedAt.toISOString().slice(0, 10),
      // Nothing is owed: this invoice is raised because the payment landed.
      dueDate: null,
      paidAt: issuedAt,
      // Stamped only once the e-mail has actually gone out, so an invoice row
      // with a NULL `issuedAt` is a readable signal that the buyer never got it.
      issuedAt: null,
      currency,
      subtotal: money(subtotal),
      taxRate: money(0),
      taxAmount: money(taxTotal),
      discountAmount: money(0),
      totalAmount: money(total),
      hasPhysicalItems,
      hasDigitalItems,
      shippingAddress,
      billingAddress: toInvoiceBillingSnapshot(order, buyerName),
      gatewayTransactionRef: gatewayRef,
      notes:
        `Raised automatically on payment settlement. Prices are tax inclusive: the total already ` +
        `contains ${currency} ${money(taxTotal)} of tax. Subtotal is net of tax and includes ` +
        `shipping of ${currency} ${money(shipping)}. Total matches orders.total_amount for ` +
        `${buildOrderNumber(order.id)}.`,
    };

    return { header, lines };
  }

  /**
   * Send the invoice and stamp `issuedAt` on success.
   *
   * A failure here is logged and swallowed by `dispatchClaim`'s catch: the
   * invoice row is already durable and visible on the admin invoice list, so
   * the accounting record survives even when the mail transport does not.
   * There is deliberately no retry beyond `MailService`'s own — a re-driven
   * settlement finds the invoice row and sends nothing, which is the right
   * trade against ever double-invoicing a customer.
   */
  private async emailInvoice(order: Order, invoice: Invoice): Promise<void> {
    const email = order.user?.email;

    if (!email) {
      this.logger.error(`Invoice ${invoice.invoiceNumber} has no recipient address — raised but not sent`);
      return;
    }

    await this.mailService.sendInvoiceEmail(email, order.user.firstName, this.buildEmailData(order, invoice));

    await this.dataSource.getRepository(Invoice).update(invoice.id, { issuedAt: new Date() });

    this.logger.log(`Invoice ${invoice.invoiceNumber} e-mailed for order ${order.id}`);
  }

  /**
   * Build the e-mail view model from the ORDER's recorded figures.
   *
   * Built from the order rather than from the invoice row on purpose: the order
   * is where shipping lives, and the e-mail shows the breakdown the customer
   * recognises (items, shipping, total, tax included) rather than the header's
   * accounting split. `grandTotal` is `orders.total_amount` — the same number
   * `invoice.totalAmount` was just written from.
   */
  private buildEmailData(order: Order, invoice: Invoice): InvoiceEmailData {
    const lines: InvoiceEmailLine[] = [];
    let itemsTotal = 0;

    for (const item of order.items ?? []) {
      const variant = item.bookFormatVariant;
      if (!variant) continue;

      const lineTotal = lineTotalOf(item);
      itemsTotal += lineTotal;

      lines.push({
        title: variant.book?.title ?? 'Your purchase',
        quantity: item.quantity,
        unitPrice: money(num(item.unit_price)),
        lineTotal: money(lineTotal),
        // Preserves the NULL/0 distinction the invoice column cannot hold.
        taxRate: item.tax_percentage == null ? null : money(num(item.tax_percentage)),
        taxAmount: money(num(item.tax_amount)),
      });
    }

    return {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      orderNumber: buildOrderNumber(order.id),
      currency: order.currency || 'INR',
      lines,
      itemsTotal: money(itemsTotal),
      shippingTotal: money(num(order.shipping_cost)),
      taxTotal: money(num(order.tax_amount)),
      grandTotal: money(num(order.total_amount)),
      billTo: buildBillToBlock(order),
      orderUrl: this.buildOrderUrl(order.id),
    };
  }

  /**
   * Storefront deep link the e-mail points at. Identical to the digital
   * delivery and physical fulfilment links: `/orders` is the protected
   * order-history route and the id rides along as a query param, since there is
   * no per-order route yet.
   */
  private buildOrderUrl(orderId: number): string {
    const base = (this.configService.get<string>('FRONTEND_URL') || FRONTEND_URL_FALLBACK).replace(/\/+$/, '');
    return `${base}/orders?order=${orderId}`;
  }
}

/**
 * The line's recorded total.
 *
 * `order_items.total_price` is a STORED generated column (`quantity *
 * unit_price`), so it is the recorded figure and is used as-is. The fallback
 * covers an entity that was never round-tripped through Postgres (a fixture, an
 * in-memory instance) and applies the column's own definition rather than
 * deriving the amount some other way.
 */
function lineTotalOf(item: OrderItem): number {
  if (item.total_price !== null && item.total_price !== undefined) {
    return num(item.total_price);
  }
  return round2(num(item.unit_price) * item.quantity);
}

/** Postgres reports a duplicate key as SQLSTATE 23505, whatever wraps it. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; driverError?: { code?: string } } | null)?.code;
  const driverCode = (error as { driverError?: { code?: string } } | null)?.driverError?.code;
  return code === PG_UNIQUE_VIOLATION || driverCode === PG_UNIQUE_VIOLATION;
}

/** Falls back to the address on file, then to the e-mail, so `fullName` is never blank. */
function buildBuyerName(order: Order): string {
  const parts = [order.user?.firstName, order.user?.lastName].filter((part): part is string => !!part && !!part.trim());
  return parts.join(' ').trim() || order.user?.email || 'Customer';
}

function toInvoiceShippingSnapshot(order: Order, buyerName: string): InvoiceShippingAddressSnapshot | null {
  const address = order.shipping_address;

  if (!address) {
    // Digital-only orders carry no address, and `invoices.shippingAddress` is
    // nullable for exactly that case.
    return null;
  }

  const line2 = asText(address.line2);
  const phone = asText(address.phone);

  return {
    // `orders.shipping_address` (see `toShippingAddressSnapshot`) stores no
    // name — the storefront renders the account holder's — so it comes from the
    // buyer here.
    fullName: buyerName,
    addressLine1: asText(address.line1),
    ...(line2 ? { addressLine2: line2 } : {}),
    city: asText(address.city),
    state: asText(address.state),
    postalCode: asText(address.postalCode),
    country: asText(address.country),
    ...(phone ? { phone } : {}),
  };
}

function toInvoiceBillingSnapshot(order: Order, buyerName: string): BillingAddressSnapshot | null {
  const address = order.shipping_address;

  if (!address) {
    return null;
  }

  // Magic Pages never collects a separate billing address, so the shipping
  // snapshot is the billing snapshot, plus the account e-mail for the
  // accounting record.
  const line2 = asText(address.line2);
  const email = order.user?.email;

  return {
    fullName: buyerName,
    addressLine1: asText(address.line1),
    ...(line2 ? { addressLine2: line2 } : {}),
    city: asText(address.city),
    state: asText(address.state),
    postalCode: asText(address.postalCode),
    country: asText(address.country),
    ...(email ? { email } : {}),
  };
}

/** Plain-text bill-to block for the e-mail; null when there is no address to print. */
function buildBillToBlock(order: Order): string | null {
  const address = order.shipping_address;
  const name = buildBuyerName(order);

  if (!address) {
    return name;
  }

  const lines = [
    name,
    asText(address.line1),
    asText(address.line2),
    [asText(address.city), asText(address.state), asText(address.postalCode)].filter(Boolean).join(' '),
    asText(address.country),
  ].filter((line) => line.length > 0);

  return lines.join('\n');
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The customer-visible order reference. Duplicated from `OrdersService`'s
 * mapper (as `PhysicalFulfillmentService` also does) rather than imported, to
 * keep this service free of a dependency on the orders module.
 */
function buildOrderNumber(orderId: number): string {
  return `MP-${String(orderId).padStart(6, '0')}`;
}
