import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCartTables1732692000000 implements MigrationInterface {
    name = 'CreateCartTables1732692000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create carts table
        await queryRunner.query(`
      CREATE TABLE carts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id integer NOT NULL,
        status varchar(32) DEFAULT 'ACTIVE',
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        CONSTRAINT fk_carts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

        // Create index on user_id
        await queryRunner.query(`
      CREATE INDEX idx_carts_user ON carts(user_id)
    `);

        // Create cart_items table
        await queryRunner.query(`
      CREATE TABLE cart_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cart_id uuid NOT NULL,
        book_variant_id integer NOT NULL,
        qty int NOT NULL CHECK (qty > 0),
        unit_price numeric(10,2) NOT NULL,
        title varchar(255),
        cover_image_url text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
        CONSTRAINT fk_cart_items_variant FOREIGN KEY (book_variant_id) REFERENCES book_format_varients(id) ON DELETE RESTRICT,
        CONSTRAINT uq_cart_items_cart_variant UNIQUE(cart_id, book_variant_id)
      )
    `);

        // Create index on cart_id
        await queryRunner.query(`
      CREATE INDEX idx_cart_items_cart ON cart_items(cart_id)
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS cart_items CASCADE`);
        await queryRunner.query(`DROP TABLE IF EXISTS carts CASCADE`);
    }
}
