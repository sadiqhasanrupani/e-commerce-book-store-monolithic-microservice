import { Injectable } from '@nestjs/common';

/**
 * Resolves the tax already contained in a price.
 *
 * Tax at Magic Pages is INCLUSIVE: a variant's `price` is what the customer
 * pays, and `taxPercentage` describes how much of that price is tax. Nothing
 * here ever increases a total — this service only says how to split a number
 * the customer was already going to be charged. That is the whole reason the
 * feature could be added without touching the Razorpay amount.
 *
 * It exists as its own service for the same reason `ShippingRateService` does:
 * the cart quote and the order record must agree. If the formula lived in both
 * `cart.service` and `checkout.service`, the basket could show one tax figure
 * and the invoice record another, which is exactly the class of bug that
 * produced the shipping quote/charge mismatch.
 *
 * Units are MAJOR (rupees) throughout, matching `orders.total_amount`,
 * `orders.shipping_cost` and the cart summary DTOs.
 */

/** A priced line, in whatever shape the caller already holds. */
export interface TaxableLine {
  /** Price per unit, in major units, tax already inside it. */
  unitPrice: number;
  quantity: number;
  /** `false`/absent means the line carries no tax at all. */
  includeTax?: boolean | null;
  /** Rate as a percentage, e.g. `18` for 18%. */
  taxPercentage?: number | null;
}

/** Round to the 2 decimal places the `numeric(10,2)` columns store. */
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

@Injectable()
export class TaxService {
  /**
   * The tax contained in one line's total.
   *
   * For a tax-inclusive price `P` at rate `r`, the pre-tax base is
   * `P / (1 + r/100)`, so the tax component is `P - base`, which simplifies to
   * `P × r / (100 + r)`. The simplified form is used directly because it avoids
   * a division-then-subtraction that can leave a sub-paisa residue.
   *
   * Worked example: ₹250 × 2 at 18% → 500 × 18 / 118 = ₹76.27.
   *
   * Returns 0 — never a negative or a NaN — for a line that is untaxed, has no
   * rate, or carries a nonsensical rate. A bad rate must not be able to corrupt
   * an order total, and since this figure is presentational the safe direction
   * is to show no tax rather than a wrong one.
   */
  lineTax(line: TaxableLine): number {
    if (!line.includeTax) return 0;

    const rate = Number(line.taxPercentage);
    if (!Number.isFinite(rate) || rate <= 0) return 0;

    const lineTotal = Number(line.unitPrice) * Number(line.quantity);
    if (!Number.isFinite(lineTotal) || lineTotal <= 0) return 0;

    return round2((lineTotal * rate) / (100 + rate));
  }

  /**
   * Total tax contained in a set of lines.
   *
   * Each line is rounded before summing, deliberately: the per-line figures are
   * what an invoice itemises, so the printed lines must add up to the printed
   * total. Rounding once at the end would produce a total that disagrees with
   * its own breakdown by a paisa.
   */
  totalTax(lines: TaxableLine[]): number {
    return round2((lines ?? []).reduce((sum, line) => sum + this.lineTax(line), 0));
  }

  /**
   * Shipping is not taxed. Stated as its own method so the assumption is
   * visible and testable rather than implied by the absence of a call — if
   * shipping ever becomes taxable, this is the seam to change.
   */
  shippingTax(): number {
    return 0;
  }
}
