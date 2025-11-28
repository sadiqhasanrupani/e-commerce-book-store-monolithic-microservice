import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderTables1732700100000 implements MigrationInterface {
  name = 'CreateOrderTables1732700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create payment_status enum
    await queryRunner.query(`
      CREATE TYPE "payment_status_enum" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED')
    `);

    // Create fulfillment_status enum
    await queryRunner.query(`
      CREATE TYPE "fulfillment_status_enum" AS ENUM ('NOT_STARTED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED')
    `);

    // Create orders table
    await queryRunner.query(`
      CREATE TABLE "orders" (
        "order_id" SERIAL NOT NULL,
        "payment_status" "payment_status_enum" NOT NULL DEFAULT 'PENDING',
        "fulfillment_status" "fulfillment_status_enum" NOT NULL DEFAULT 'NOT_STARTED',
        "total_amount" numeric(10,2) NOT NULL,
        "discount_code" character varying,
        "gift_card_amount" numeric(10,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "userId" uuid,
        CONSTRAINT "PK_order_id" PRIMARY KEY ("order_id")
      )
    `);

    // Create order_status_logs table
    await queryRunner.query(`
      CREATE TABLE "order_status_logs" (
        "id" SERIAL NOT NULL,
        "payment_status" "payment_status_enum",
        "fulfillment_status" "fulfillment_status_enum",
        "comment" text,
        "changed_at" TIMESTAMP NOT NULL DEFAULT now(),
        "orderId" integer,
        "changedById" uuid,
        CONSTRAINT "PK_order_status_logs_id" PRIMARY KEY ("id")
      )
    `);

    // Add foreign keys
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD CONSTRAINT "FK_orders_user"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE NO ACTION
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "order_status_logs"
      ADD CONSTRAINT "FK_order_status_logs_order"
      FOREIGN KEY ("orderId") REFERENCES "orders"("order_id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "order_status_logs"
      ADD CONSTRAINT "FK_order_status_logs_user"
      FOREIGN KEY ("changedById") REFERENCES "users"("id")
      ON DELETE NO ACTION
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys
    await queryRunner.query(`
      ALTER TABLE "order_status_logs" DROP CONSTRAINT "FK_order_status_logs_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "order_status_logs" DROP CONSTRAINT "FK_order_status_logs_order"
    `);

    await queryRunner.query(`
      ALTER TABLE "orders" DROP CONSTRAINT "FK_orders_user"
    `);

    // Drop tables
    await queryRunner.query(`DROP TABLE "order_status_logs"`);
    await queryRunner.query(`DROP TABLE "orders"`);

    // Drop enums
    await queryRunner.query(`DROP TYPE "fulfillment_status_enum"`);
    await queryRunner.query(`DROP TYPE "payment_status_enum"`);
  }
}
