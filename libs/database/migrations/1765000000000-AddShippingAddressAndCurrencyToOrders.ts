import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds shipping_address (jsonb snapshot) and currency to the orders table so
 * the customer-facing order read endpoints (GET /user/orders, /user/orders/:id)
 * can return the address the order was placed with and the order's currency.
 *
 * Both columns are nullable/defaulted so existing rows remain valid:
 *   - shipping_address: nullable (old orders have no snapshot)
 *   - currency: defaults to 'INR' (back-fills existing rows)
 */
export class AddShippingAddressAndCurrencyToOrders1765000000000
  implements MigrationInterface
{
  name = 'AddShippingAddressAndCurrencyToOrders1765000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_address" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "currency" character varying(3) NOT NULL DEFAULT 'INR'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_address"`,
    );
  }
}
