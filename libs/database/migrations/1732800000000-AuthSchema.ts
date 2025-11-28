import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthSchema1732800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create user_status enum
    await queryRunner.query(
      `CREATE TYPE "user_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED')`,
    );

    // 2. Add columns to users table
    await queryRunner.query(
      `ALTER TABLE "users" ADD "status" "user_status" NOT NULL DEFAULT 'PENDING'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email_verified_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "middle_name" character varying(100)`,
    );

    // 3. Create email_verifications table
    await queryRunner.query(
      `CREATE TABLE "email_verifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" integer,
        "purpose" character varying(32) NOT NULL,
        "token_hash" character varying(255) NOT NULL,
        "token_type" character varying(16) NOT NULL,
        "attempts" integer DEFAULT 0,
        "used" boolean DEFAULT false,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
        CONSTRAINT "PK_email_verifications" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verifications" ADD CONSTRAINT "FK_email_verifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_email_verifications_user" ON "email_verifications" ("user_id")`,
    );

    // 4. Create idempotency_keys table
    await queryRunner.query(
      `CREATE TABLE "idempotency_keys" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "key" character varying(255) NOT NULL,
        "user_id" integer,
        "route" character varying(255) NOT NULL,
        "response" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "UQ_idempotency_keys_key" UNIQUE ("key"),
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("id")
      )`,
    );

    // 5. Create refresh_tokens table
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" integer,
        "token_hash" character varying(255) NOT NULL,
        "user_agent" text,
        "ip" character varying(45),
        "revoked" boolean DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop refresh_tokens
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_refresh_tokens_user"`,
    );
    await queryRunner.query(`DROP INDEX "idx_refresh_tokens_user"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);

    // Drop idempotency_keys
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);

    // Drop email_verifications
    await queryRunner.query(
      `ALTER TABLE "email_verifications" DROP CONSTRAINT "FK_email_verifications_user"`,
    );
    await queryRunner.query(`DROP INDEX "idx_email_verifications_user"`);
    await queryRunner.query(`DROP TABLE "email_verifications"`);

    // Drop columns from users
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "middle_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_verified_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "status"`);

    // Drop enum
    await queryRunner.query(`DROP TYPE "user_status"`);
  }
}
