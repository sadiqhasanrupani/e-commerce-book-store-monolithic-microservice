import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds per-line digital delivery tracking to `order_items`.
 *
 * Digital variants (`!isPhysicalFormat(variant.format)`) previously had no
 * post-payment step at all: a buyer paid for an ebook and nothing was sent.
 * The delivery itself is triggered from `PaymentSettlementService`, the single
 * lock-protected place a payment result becomes database state, and these two
 * columns are what make that trigger *exactly once*.
 *
 * Why the tracking lives on `order_items` and not on `orders`: one order can
 * mix physical and digital lines, so "has this been delivered?" is only
 * answerable per line. Physical lines keep `digital_delivery_status` NULL
 * forever.
 *
 * The idempotency mechanism is a conditional UPDATE against
 * `digital_delivery_status` issued inside the settlement transaction while the
 * parent order row is held under `FOR UPDATE`:
 *
 *   UPDATE order_items SET digital_delivery_status = 'sending'
 *   WHERE order_item_id = $1
 *     AND (digital_delivery_status IS NULL OR digital_delivery_status = 'failed')
 *
 * Settlement is reachable from the Razorpay webhook, the reconciliation cron
 * and the storefront's `verifyOrder` poll, and all three can land on the same
 * order. Whichever one wins the order lock claims the rows and sends the
 * e-mail; the others match zero rows and send nothing.
 *
 * Both columns are nullable with no default and no backfill. Orders that were
 * already paid before this migration keep NULL, which reads as "not delivered"
 * — deliberately: retro-sending download e-mails for historical purchases is a
 * business decision, not a migration's call. Those buyers can still download
 * from the order page, which authorises on payment state rather than on
 * delivery state.
 */
export class AddDigitalDeliveryToOrderItems1765300000000 implements MigrationInterface {
  name = 'AddDigitalDeliveryToOrderItems1765300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. The status type. Values match the `DigitalDeliveryStatus` TypeScript
    //    enum exactly, in lowercase — the same convention
    //    `AlignTransactionProviderEnum1765200000000` converged the transaction
    //    provider type on, so an environment that runs migrations and one that
    //    ran with `DATABASE_SYNC=true` end up with the identical type.
    await queryRunner.query(
      `CREATE TYPE "public"."order_items_digital_delivery_status_enum" AS ENUM('sending', 'delivered', 'failed')`,
    );

    // 2. Nullable, no default: NULL is the meaningful "not attempted" state and
    //    is what every existing row must keep.
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD COLUMN "digital_delivery_status" "public"."order_items_digital_delivery_status_enum"`,
    );

    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "digital_delivered_at" TIMESTAMP WITH TIME ZONE`);

    // 3. Partial index over the non-NULL rows only. The overwhelming majority
    //    of order lines are physical and stay NULL, so indexing them would be
    //    dead weight. This supports the operational query that matters —
    //    finding lines stuck in 'sending' (claimed, then the process died
    //    before the e-mail was finalised) or sitting in 'failed' and needing a
    //    re-send.
    await queryRunner.query(
      `CREATE INDEX "IDX_order_items_digital_delivery_status" ON "order_items" ("digital_delivery_status") WHERE "digital_delivery_status" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_order_items_digital_delivery_status"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN IF EXISTS "digital_delivered_at"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN IF EXISTS "digital_delivery_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."order_items_digital_delivery_status_enum"`);
  }
}
