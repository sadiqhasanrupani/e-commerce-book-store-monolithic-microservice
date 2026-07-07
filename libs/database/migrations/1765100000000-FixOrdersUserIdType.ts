import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes a type mismatch on orders."userId".
 *
 * The column was created as `uuid` in CreateOrderTables1732700100000, but the
 * users table primary key (`users.id`) is an `integer`
 * (User entity: `@PrimaryGeneratedColumn() id: number`). The FK_orders_user
 * constraint therefore references an integer PK from a uuid column, and the
 * `@ManyToOne(() => User) user` relation cannot resolve correctly against a
 * uuid column. This migration converts orders."userId" to `integer` so the
 * relation and the user-scoped queries in OrdersService work.
 *
 * The column NAME ("userId") is intentionally kept so TypeORM's default join
 * column for `@ManyToOne(() => User) user: User` still resolves (no explicit
 * @JoinColumn is declared on the relation).
 *
 * DEV-ONLY DATA RESET:
 * A uuid -> integer cast is not generally possible in Postgres (uuid values
 * are not integers), so any pre-existing orders / order_items rows cannot be
 * preserved. This is acceptable because the orders feature is not yet live and
 * this is a DEV database. The migration TRUNCATEs `order_items` and `orders`
 * (CASCADE) before altering the column type. DO NOT run this against a
 * database holding real order data without first migrating that data.
 */
export class FixOrdersUserIdType1765100000000 implements MigrationInterface {
  name = 'FixOrdersUserIdType1765100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Dev-only data reset: existing uuid userId values cannot be cast to
    //    integer, so clear dependent order data first. order_status_logs also
    //    FK-references orders(order_id) ON DELETE CASCADE, so it is cleared too.
    await queryRunner.query(
      `TRUNCATE TABLE "order_items", "order_status_logs", "orders" RESTART IDENTITY CASCADE`,
    );

    // 2. Drop the FK so the column type can be altered.
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_orders_user"`,
    );

    // 3. Convert the column type uuid -> integer.
    //    USING NULL: the table is empty after the truncate above, so there are
    //    no values to convert; this just satisfies Postgres' requirement for an
    //    explicit cast expression when changing between incompatible types.
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "userId" TYPE integer USING NULL`,
    );

    // 4. Re-add the FK now that the column type matches users.id (integer).
    await queryRunner.query(
      `ALTER TABLE "orders"
       ADD CONSTRAINT "FK_orders_user"
       FOREIGN KEY ("userId") REFERENCES "users"("id")
       ON DELETE NO ACTION
       ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: integer -> uuid. The table is cleared again because the forward
    // migration discarded the original uuid values and an integer -> uuid cast
    // is likewise not possible.
    await queryRunner.query(
      `TRUNCATE TABLE "order_items", "order_status_logs", "orders" RESTART IDENTITY CASCADE`,
    );

    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_orders_user"`,
    );

    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "userId" TYPE uuid USING NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "orders"
       ADD CONSTRAINT "FK_orders_user"
       FOREIGN KEY ("userId") REFERENCES "users"("id")
       ON DELETE NO ACTION
       ON UPDATE NO ACTION`,
    );
  }
}
