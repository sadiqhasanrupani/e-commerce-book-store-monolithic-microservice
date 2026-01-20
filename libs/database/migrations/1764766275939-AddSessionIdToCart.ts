import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddSessionIdToCart
 * 
 * Adds guest cart support by:
 * 1. Making user_id nullable
 * 2. Adding session_id column for guest carts
 * 3. Adding CHECK constraint (exactly one identity required)
 * 4. Adding indexes for session_id lookups
 * 5. Adding partial index on user_id for authenticated cart lookups
 * 
 * This migration is fully reversible and idempotent (safe to re-run).
 */
export class AddSessionIdToCart1764766275939 implements MigrationInterface {
  name = 'AddSessionIdToCart1764766275939';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add session_id column (IF NOT EXISTS)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'carts' AND column_name = 'session_id'
        ) THEN
          ALTER TABLE carts ADD COLUMN session_id uuid NULL;
        END IF;
      END $$;
    `);

    // 2. Make user_id nullable
    // First drop the existing FK constraint
    await queryRunner.query(`
      ALTER TABLE carts 
      DROP CONSTRAINT IF EXISTS fk_carts_user
    `);

    // Make the column nullable (idempotent - DROP NOT NULL is safe if already nullable)
    await queryRunner.query(`
      ALTER TABLE carts 
      ALTER COLUMN user_id DROP NOT NULL
    `);

    // Re-add the FK constraint (now allows NULL)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'fk_carts_user' AND table_name = 'carts'
        ) THEN
          ALTER TABLE carts 
          ADD CONSTRAINT fk_carts_user 
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // 3. Add CHECK constraint (drop + recreate for idempotency)
    await queryRunner.query(`
      ALTER TABLE carts DROP CONSTRAINT IF EXISTS chk_cart_identity
    `);
    await queryRunner.query(`
      ALTER TABLE carts
      ADD CONSTRAINT chk_cart_identity 
      CHECK (
        (user_id IS NOT NULL AND session_id IS NULL) OR
        (user_id IS NULL AND session_id IS NOT NULL)
      )
    `);

    // 4. Add index on session_id for guest cart lookups (IF NOT EXISTS)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_carts_session 
      ON carts(session_id) 
      WHERE session_id IS NOT NULL
    `);

    // 5. Add unique index on session_id for ACTIVE guest carts (IF NOT EXISTS)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_session_active 
      ON carts(session_id) 
      WHERE session_id IS NOT NULL AND status = 'ACTIVE'
    `);

    // 6. Add partial index on user_id for authenticated cart lookups (IF NOT EXISTS)
    // Preserves performance now that user_id is nullable
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_user_active 
      ON carts(user_id) 
      WHERE user_id IS NOT NULL AND status = 'ACTIVE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback in reverse order

    // 1. Drop authenticated cart index
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_carts_user_active
    `);

    // 2. Drop unique index on session_id
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_carts_session_active
    `);

    // 3. Drop index on session_id
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_carts_session
    `);

    // 4. Drop CHECK constraint
    await queryRunner.query(`
      ALTER TABLE carts 
      DROP CONSTRAINT IF EXISTS chk_cart_identity
    `);

    // 5. Delete any guest carts (required before making user_id NOT NULL)
    await queryRunner.query(`
      DELETE FROM carts WHERE session_id IS NOT NULL
    `);

    // 6. Make user_id NOT NULL again
    // First drop FK
    await queryRunner.query(`
      ALTER TABLE carts 
      DROP CONSTRAINT IF EXISTS fk_carts_user
    `);

    // Make NOT NULL
    await queryRunner.query(`
      ALTER TABLE carts 
      ALTER COLUMN user_id SET NOT NULL
    `);

    // Re-add FK
    await queryRunner.query(`
      ALTER TABLE carts 
      ADD CONSTRAINT fk_carts_user 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    `);

    // 7. Drop session_id column
    await queryRunner.query(`
      ALTER TABLE carts 
      DROP COLUMN IF EXISTS session_id
    `);
  }
}

