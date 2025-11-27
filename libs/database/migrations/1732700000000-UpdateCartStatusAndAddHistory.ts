import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCartStatusAndAddHistory1732700000000 implements MigrationInterface {
    name = 'UpdateCartStatusAndAddHistory1732700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add checkout_started_at column
        await queryRunner.query(`
      ALTER TABLE carts
      ADD COLUMN checkout_started_at timestamptz
    `);

        // Update status column to use enum
        await queryRunner.query(`
      CREATE TYPE cart_status_enum AS ENUM ('ACTIVE', 'CHECKOUT', 'COMPLETED', 'ABANDONED')
    `);

        await queryRunner.query(`
      ALTER TABLE carts
      ALTER COLUMN status TYPE cart_status_enum USING status::cart_status_enum
    `);

        await queryRunner.query(`
      ALTER TABLE carts
      ALTER COLUMN status SET DEFAULT 'ACTIVE'
    `);

        // Create cart_history table for archiving completed/abandoned carts
        await queryRunner.query(`
      CREATE TABLE cart_history (
        id uuid PRIMARY KEY,
        user_id integer NOT NULL,
        status cart_status_enum NOT NULL,
        checkout_started_at timestamptz,
        completed_at timestamptz DEFAULT now(),
        total_amount numeric(10,2),
        items_count integer,
        items_data jsonb,
        created_at timestamptz,
        updated_at timestamptz
      )
    `);

        await queryRunner.query(`
      CREATE INDEX idx_cart_history_user ON cart_history(user_id)
    `);

        await queryRunner.query(`
      CREATE INDEX idx_cart_history_status ON cart_history(status)
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS cart_history CASCADE`);
        await queryRunner.query(`ALTER TABLE carts DROP COLUMN IF EXISTS checkout_started_at`);
        await queryRunner.query(`ALTER TABLE carts ALTER COLUMN status TYPE varchar(32)`);
        await queryRunner.query(`DROP TYPE IF EXISTS cart_status_enum CASCADE`);
    }
}
