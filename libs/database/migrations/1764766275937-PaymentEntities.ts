import { MigrationInterface, QueryRunner } from "typeorm";

export class PaymentEntities1764766275937 implements MigrationInterface {
    name = 'PaymentEntities1764766275937'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."refunds_status_enum" AS ENUM('INITIATED', 'SUCCESS', 'FAILED')`);
        await queryRunner.query(`CREATE TABLE "refunds" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "amount" numeric(10,2) NOT NULL, "status" "public"."refunds_status_enum" NOT NULL DEFAULT 'INITIATED', "acquirer_data" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "transactionId" uuid, CONSTRAINT "PK_5106efb01eeda7e49a78b869738" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."transactions_status_enum" AS ENUM('PENDING', 'SUCCESS', 'FAILED')`);
        await queryRunner.query(`CREATE TYPE "public"."transactions_provider_enum" AS ENUM('PHONEPE', 'RAZORPAY')`);
        await queryRunner.query(`CREATE TABLE "transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gateway_ref_id" character varying, "amount" numeric(10,2) NOT NULL, "currency" character varying NOT NULL, "status" "public"."transactions_status_enum" NOT NULL DEFAULT 'PENDING', "provider" "public"."transactions_provider_enum" NOT NULL, "raw_request" jsonb, "raw_response" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "orderId" integer, CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payments" ("payment_id" SERIAL NOT NULL, "provider" character varying NOT NULL, "status" character varying NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'USD', "transaction_id" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "order_id" integer, CONSTRAINT "REL_b2f7b823a21562eeca20e72b00" UNIQUE ("order_id"), CONSTRAINT "PK_8866a3cfff96b8e17c2b204aae0" PRIMARY KEY ("payment_id"))`);
        await queryRunner.query(`CREATE TABLE "gift_cards" ("gift_card_id" SERIAL NOT NULL, "code" character varying NOT NULL, "initial_amount" numeric(10,2) NOT NULL, "balance" numeric(10,2) NOT NULL, "expiration_date" date, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_08ff997110a4e3842076964f0ed" UNIQUE ("code"), CONSTRAINT "PK_c67068cb5d48f939d31368efbb7" PRIMARY KEY ("gift_card_id"))`);
        await queryRunner.query(`CREATE TYPE "public"."discount_codes_discount_type_enum" AS ENUM('percentage', 'fixed')`);
        await queryRunner.query(`CREATE TABLE "discount_codes" ("code_id" SERIAL NOT NULL, "code" character varying NOT NULL, "description" character varying, "discount_type" "public"."discount_codes_discount_type_enum" NOT NULL, "discount_value" numeric(10,2) NOT NULL, "min_order_amount" numeric(10,2) NOT NULL DEFAULT '0', "valid_from" date, "valid_until" date, "usage_limit" integer NOT NULL DEFAULT '0', "usage_count" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_b967edd0d46547d4a92b4a1c6b3" UNIQUE ("code"), CONSTRAINT "PK_b9f1b787736343d32281e731f78" PRIMARY KEY ("code_id"))`);
        await queryRunner.query(`CREATE TABLE "audit_log" ("audit_id" SERIAL NOT NULL, "timestamp" TIMESTAMP NOT NULL DEFAULT now(), "user_id" integer, "table_name" character varying NOT NULL, "record_id" integer NOT NULL, "action" character varying NOT NULL, "details" jsonb, CONSTRAINT "PK_90d705dc65e834a7bfc79ea4df0" PRIMARY KEY ("audit_id"))`);
        await queryRunner.query(`ALTER TABLE "refunds" ADD CONSTRAINT "FK_b2b8c0c33487a5b9a573767355f" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transactions" ADD CONSTRAINT "FK_2fdbbae70ff802bc8b703ee7c5c" FOREIGN KEY ("orderId") REFERENCES "orders"("order_id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_b2f7b823a21562eeca20e72b006" FOREIGN KEY ("order_id") REFERENCES "orders"("order_id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_b2f7b823a21562eeca20e72b006"`);
        await queryRunner.query(`ALTER TABLE "transactions" DROP CONSTRAINT "FK_2fdbbae70ff802bc8b703ee7c5c"`);
        await queryRunner.query(`ALTER TABLE "refunds" DROP CONSTRAINT "FK_b2b8c0c33487a5b9a573767355f"`);
        await queryRunner.query(`DROP TABLE "audit_log"`);
        await queryRunner.query(`DROP TABLE "discount_codes"`);
        await queryRunner.query(`DROP TYPE "public"."discount_codes_discount_type_enum"`);
        await queryRunner.query(`DROP TABLE "gift_cards"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TABLE "transactions"`);
        await queryRunner.query(`DROP TYPE "public"."transactions_provider_enum"`);
        await queryRunner.query(`DROP TYPE "public"."transactions_status_enum"`);
        await queryRunner.query(`DROP TABLE "refunds"`);
        await queryRunner.query(`DROP TYPE "public"."refunds_status_enum"`);
    }

}
