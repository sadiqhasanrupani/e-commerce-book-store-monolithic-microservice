import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records the tax already contained in an order's prices.
 *
 * Tax at Magic Pages is INCLUSIVE: a variant's `price` is what the customer
 * pays and `taxPercentage` describes how much of that price is tax. Nothing
 * here changes any total. `orders.total_amount` remains
 * `Σ(unit_price × quantity) + shipping_cost`, and the Razorpay charge is
 * untouched — these columns only record how that already-decided number splits,
 * so it can be shown on the order and itemised on an invoice.
 *
 * Before this, the storefront's order modal carried a comment noting there was
 * "no tax column anywhere in the orders module" and presented tax as inclusive
 * without a figure, because deriving one from `total_amount` would have
 * fabricated a number the customer was never quoted. These columns are that
 * missing figure, captured at checkout from the locked variant rows.
 *
 * Column notes:
 *  - `orders.tax_amount` is the order's total tax, `numeric(10,2)` default 0,
 *    in MAJOR units (rupees) like `total_amount` and `shipping_cost`. It is a
 *    component OF `total_amount`, never an addition to it.
 *  - `order_items.tax_percentage` / `order_items.tax_amount` snapshot the rate
 *    and the resulting amount per line at checkout time, so the breakdown stays
 *    correct even if an admin later edits the variant's rate. This mirrors how
 *    `unit_price` is already snapshotted rather than read back from the variant.
 *  - Per-line as well as per-order because an invoice itemises tax by line, and
 *    a basket can mix rates (an 18% paperback beside a 5% workbook). The
 *    per-line figures are rounded first and then summed, so the printed lines
 *    always add up to the printed total.
 *  - `tax_percentage` is `numeric(5,2)` matching
 *    `book_format_variants.taxPercentage`; NULL means the line carried no tax,
 *    which is distinct from a stored 0.
 *
 * No backfill. Historical orders keep `tax_amount` 0 and NULL line rates, which
 * is exactly what was true of them: no tax was ever computed or quoted, and
 * inventing one retrospectively would misstate what those customers were told
 * they paid.
 */
export class AddInclusiveTaxToOrders1765500000000 implements MigrationInterface {
  name = 'AddInclusiveTaxToOrders1765500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Order-level total. Defaulted rather than nullable: every order has a tax
    // component, and for an untaxed basket that component is genuinely zero.
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(10,2) NOT NULL DEFAULT 0`,
    );

    // Per-line snapshot. Nullable rate so "this line was never taxed" stays
    // distinguishable from "this line was taxed at 0%".
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "tax_percentage" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(10,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN IF EXISTS "tax_amount"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN IF EXISTS "tax_percentage"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "tax_amount"`);
  }
}
