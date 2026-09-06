/**
 * View model for the invoice e-mail.
 *
 * Every money field is a PRE-FORMATTED string (`"1049.82"`), never a number.
 * That is deliberate and load-bearing: the figures on an invoice must be the
 * ones the customer was actually charged, so they are read off the recorded
 * `orders` / `order_items` rows and formatted once, by
 * `InvoiceIssuanceService`, before they ever reach a template. `MailService`
 * escapes and lays these out and does no arithmetic of its own — there is no
 * second place where a rounding rule could drift away from what Razorpay took.
 *
 * Tax at Magic Pages is INCLUSIVE, so `taxTotal` is a component OF
 * `grandTotal`, never an addition to it, and the template must present it that
 * way ("includes tax of…") rather than as a line that adds up.
 *
 * Lives in `libs/contract` next to `email-provider.interface.ts` because both
 * the invoices module (producer) and the mail module (consumer) depend on it,
 * and neither should have to import the other.
 */

/** One invoiced line, mirroring one `order_items` row. */
export interface InvoiceEmailLine {
  /** Book title as recorded on the invoice line. */
  title: string;
  quantity: number;
  /** Price per unit, tax already inside it. */
  unitPrice: string;
  /** `quantity × unitPrice`, read from the order line's stored total. */
  lineTotal: string;
  /** Percentage as a plain number string (`"18.00"`), or null for an untaxed line. */
  taxRate: string | null;
  /** Tax contained in `lineTotal`. */
  taxAmount: string;
}

/** Everything the invoice e-mail renders. */
export interface InvoiceEmailData {
  /** `INV-YYYYMMDD-XXXX`, from `InvoiceNumberProvider`. */
  invoiceNumber: string;
  /** ISO date (`YYYY-MM-DD`) the invoice was raised. */
  invoiceDate: string;
  /** Customer-visible order reference, e.g. `MP-000042`. */
  orderNumber: string;
  /** ISO 4217 code, from `orders.currency`. Rendered as a code, not a symbol. */
  currency: string;
  lines: InvoiceEmailLine[];
  /** Sum of the line totals — i.e. the goods, excluding shipping. */
  itemsTotal: string;
  /** `orders.shipping_cost`. Zero for a digital-only order. */
  shippingTotal: string;
  /** `orders.tax_amount` — the tax already contained in `grandTotal`. */
  taxTotal: string;
  /** `orders.total_amount` verbatim: exactly what the customer was charged. */
  grandTotal: string;
  /** Formatted bill-to block, or null when the order carries no address. */
  billTo: string | null;
  /** Storefront deep link to the order page. */
  orderUrl: string;
}
