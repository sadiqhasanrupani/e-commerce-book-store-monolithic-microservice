import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds order-level shipment tracking and a persisted shipping cost to `orders`.
 *
 * Physical (tangible) orders previously had no post-payment lifecycle at all:
 * `fulfillment_status` was written exactly twice in the codebase — the entity
 * default (`NOT_STARTED`) and `OrdersService.cancelOrder` (`CANCELLED`) — so a
 * paid printed book sat on NOT_STARTED forever, with nowhere to record who
 * shipped it or under what tracking number. This is the storage half of the
 * physical equivalent of the digital delivery flow added in
 * `AddDigitalDeliveryToOrderItems1765300000000`.
 *
 * Why order-level and not item-level: digital delivery is per line because one
 * order can mix formats and each ebook is mailed independently. A physical
 * shipment is one parcel with one AWB, and `payment_status`/`fulfillment_status`
 * already live on `orders` rather than `order_items`. Splitting shipments per
 * line (partial dispatch) is a deliberate non-goal for v1.
 *
 * Column notes:
 *  - `carrier` / `tracking_number` / `tracking_url` are free text typed by an
 *    admin. There is no courier API integration, so nothing here is validated
 *    against a carrier system — these are display/audit values that the
 *    storefront renders and links.
 *  - `shipped_at` / `delivered_at` are timestamptz and are stamped once, on the
 *    transition into SHIPPED / DELIVERED respectively. They are NOT re-stamped
 *    on a repeated call, so they remain the true first-transition time.
 *  - `shipping_cost` is `numeric(10,2)` with default 0, matching
 *    `total_amount` / `gift_card_amount`: the orders table stores money in
 *    MAJOR units (rupees), while the storefront DTOs serialise minor units via
 *    `Math.round(x * 100)`. The flat rate is configured in paise
 *    (`SHIPPING_FLAT_RATE_PAISE`) and divided down before it is persisted here.
 *
 * Every column is nullable or defaulted and there is no backfill: historical
 * orders keep NULL tracking and a 0 shipping cost, which is exactly what was
 * true of them (they were never charged shipping and were never shipped through
 * this flow).
 */
export class AddShipmentTrackingAndShippingCostToOrders1765400000000 implements MigrationInterface {
  name = 'AddShipmentTrackingAndShippingCostToOrders1765400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Manual, admin-entered shipment identifiers. Lengths are generous rather
    // than exact: AWB formats vary per courier and a tracking URL can carry a
    // long query string.
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "carrier" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tracking_number" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tracking_url" character varying(500)`);

    // First-transition timestamps. NULL means "has not reached that state".
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipped_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP WITH TIME ZONE`);

    // NOT NULL DEFAULT 0 rather than nullable: "no shipping was charged" is 0,
    // not unknown, and a defaulted column lets every existing row stay valid
    // without a backfill pass.
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_cost" numeric(10,2) NOT NULL DEFAULT 0`,
    );

    // Supports the new admin queue query (`GET /admin/orders?fulfillmentStatus=…`),
    // which is the only query that filters on this column. Cheap, and the
    // alternative is a sequential scan over every order the shop has ever taken.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_orders_fulfillment_status" ON "orders" ("fulfillment_status")`,
    );

    // The admin list is ordered by `created_at DESC` and paginated, which is a
    // top-N query — an index turns it from a full sort into an index scan.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_orders_created_at" ON "orders" ("created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_orders_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_orders_fulfillment_status"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_cost"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivered_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipped_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "tracking_url"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "tracking_number"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "carrier"`);
  }
}
