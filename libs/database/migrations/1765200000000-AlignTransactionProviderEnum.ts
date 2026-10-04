import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns the Postgres `transactions_provider_enum` type with the application
 * enum, as part of dropping PhonePe (roadmap #6).
 *
 * Two problems are fixed at once:
 *
 * 1. CASE MISMATCH (pre-existing bug). `PaymentEntities1764766275937` created
 *    the type as ENUM('PHONEPE', 'RAZORPAY') — uppercase — while the TypeScript
 *    enum has always used lowercase values ('phonepe', 'razorpay'). Any
 *    environment that ran the migrations rather than `DATABASE_SYNC=true` would
 *    reject every INSERT into `transactions` with
 *    `invalid input value for enum transactions_provider_enum: "razorpay"`.
 *    Environments that ran with synchronize=true already had the type silently
 *    rewritten to lowercase by TypeORM, so the two drifted apart. This
 *    migration converges both starting points on the lowercase values.
 *
 * 2. PHONEPE RETENTION. `phonepe` is deliberately KEPT as a legal value.
 *    Postgres cannot remove a value from an enum type, and more importantly we
 *    must not break reads of historical PAID orders that were paid through
 *    PhonePe. New PhonePe transactions are impossible because the application
 *    no longer has a PhonePe provider and `CheckoutDto` only accepts
 *    `razorpay` — the block is at the application boundary, not the column.
 *
 * The conversion goes through `text` so it works regardless of which case the
 * database currently holds, and `lower()` normalises any legacy uppercase rows.
 */
export class AlignTransactionProviderEnum1765200000000 implements MigrationInterface {
  name = 'AlignTransactionProviderEnum1765200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Detach the column from the enum type so the type can be replaced.
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "provider" TYPE text USING "provider"::text`,
    );

    // 2. Normalise any rows written while the type held uppercase values.
    await queryRunner.query(`UPDATE "transactions" SET "provider" = lower("provider")`);

    // 3. Recreate the type with the canonical lowercase values. 'phonepe' stays
    //    so historical rows remain valid and readable.
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."transactions_provider_enum"`);
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_provider_enum" AS ENUM('phonepe', 'razorpay')`,
    );

    // 4. Re-attach. Any value outside the type would raise here — intentional:
    //    an unexpected provider string is a data problem we want surfaced, not
    //    silently coerced.
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "provider" TYPE "public"."transactions_provider_enum" USING "provider"::"public"."transactions_provider_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the original (uppercase) type definition and data casing.
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "provider" TYPE text USING "provider"::text`,
    );
    await queryRunner.query(`UPDATE "transactions" SET "provider" = upper("provider")`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."transactions_provider_enum"`);
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_provider_enum" AS ENUM('PHONEPE', 'RAZORPAY')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "provider" TYPE "public"."transactions_provider_enum" USING "provider"::"public"."transactions_provider_enum"`,
    );
  }
}
