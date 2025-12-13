import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUniqueIdempotency1764766275938 implements MigrationInterface {
  name = 'AddUniqueIdempotency1764766275938'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the column
    await queryRunner.query(`ALTER TABLE "transactions" ADD "idempotency_key" character varying`);
    // Add unique constraint
    await queryRunner.query(`ALTER TABLE "transactions" ADD CONSTRAINT "UQ_transactions_idempotency_key" UNIQUE ("idempotency_key")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP CONSTRAINT "UQ_transactions_idempotency_key"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "idempotency_key"`);
  }

}
