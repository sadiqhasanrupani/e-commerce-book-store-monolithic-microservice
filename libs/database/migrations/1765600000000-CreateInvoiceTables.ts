import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the invoicing schema: `invoices`, `invoice_items` and
 * `invoice_daily_counters`.
 *
 * ## Why this migration exists at all
 *
 * The three invoice entities have been in `libs/contract` for a while, and the
 * admin `POST /api/v1/invoices` endpoint has been live against them — but no
 * migration ever created their tables. They exist today only in environments
 * that boot with `DATABASE_SYNC=true` and let TypeORM's `synchronize` build
 * them. Any environment that is driven by migrations (which is what production
 * is supposed to be) has no invoices tables at all.
 *
 * That was survivable while invoicing was a manual admin action nobody used. It
 * stops being survivable the moment payment settlement starts raising invoices
 * automatically, so the schema is written down here before that lands.
 *
 * ## Shape
 *
 * The DDL below reproduces exactly what `synchronize` derives from the
 * entities, so this migration is a no-op on a database that already has them
 * (every statement is `IF NOT EXISTS`-guarded, and the `CREATE TYPE`s are
 * wrapped in a `duplicate_object` catch because Postgres has no
 * `CREATE TYPE IF NOT EXISTS`). Two things about that shape are easy to trip
 * over and are therefore called out:
 *
 *  - **Column names are camelCase.** No TypeORM naming strategy is configured,
 *    so a property without an explicit `name:` becomes a column of literally
 *    that name — `"invoiceNumber"`, `"totalAmount"`, `"hasPhysicalItems"`. Only
 *    the relation columns (`order_id`, `user_id`, `invoice_id`,
 *    `order_item_id`, `book_format_variant_id`) are snake_case, because those
 *    carry an explicit `@JoinColumn({ name: … })`.
 *  - **Money is `numeric` stored as string** in the entity, deliberately, to
 *    keep JS floats away from currency. `numeric(10,2)` for amounts,
 *    `numeric(5,2)` for percentage rates — the same precisions
 *    `orders`/`order_items` use, so a figure copied from an order onto an
 *    invoice cannot be silently re-rounded.
 *
 * Foreign keys are `ON DELETE RESTRICT` for the order and the buyer (an invoice
 * is a financial record; deleting the thing it invoices must fail loudly),
 * `CASCADE` from an invoice to its own lines, and `SET NULL` for the two soft
 * audit links on a line, matching the entity definitions.
 *
 * The UNIQUE constraint on `invoices.order_id` — the one that makes automatic
 * invoicing exactly-once — is deliberately NOT here. It ships in the next
 * migration on its own, because on a database that already had these tables
 * (via `synchronize`) this migration does nothing, and the constraint still
 * needs to be applied there.
 */
export class CreateInvoiceTables1765600000000 implements MigrationInterface {
  name = 'CreateInvoiceTables1765600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum types ─────────────────────────────────────────────────────────
    // Postgres has no `CREATE TYPE IF NOT EXISTS`, so each is wrapped in a
    // block that swallows `duplicate_object`. That keeps this migration
    // re-runnable and a no-op where `synchronize` already created the type.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."invoices_status_enum" AS ENUM(
          'DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."invoice_items_itemtype_enum" AS ENUM('TANGIBLE', 'INTANGIBLE');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // Mirrors `BookFormat`. The values are the enum's lowercase string values,
    // not its TypeScript member names — the same set `book_format_varients`
    // already stores.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."invoice_items_format_enum" AS ENUM(
          'hardcover', 'paperback', 'physical',
          'ebook', 'pdf', 'epub', 'audiobook', 'docx', 'worksheet'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // ── invoices ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "invoices" (
        "id"                    uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoiceNumber"         character varying(32) NOT NULL,
        "order_id"              integer NOT NULL,
        "user_id"               integer NOT NULL,
        "status"                "public"."invoices_status_enum" NOT NULL DEFAULT 'DRAFT',
        "invoiceDate"           date NOT NULL,
        "dueDate"               date,
        "issuedAt"              TIMESTAMP WITH TIME ZONE,
        "paidAt"                TIMESTAMP WITH TIME ZONE,
        "currency"              character varying(3) NOT NULL DEFAULT 'INR',
        "subtotal"              numeric(10,2) NOT NULL,
        "taxRate"               numeric(5,2) NOT NULL DEFAULT 0,
        "taxAmount"             numeric(10,2) NOT NULL DEFAULT 0,
        "discountAmount"        numeric(10,2) NOT NULL DEFAULT 0,
        "totalAmount"           numeric(10,2) NOT NULL,
        "hasPhysicalItems"      boolean NOT NULL DEFAULT false,
        "hasDigitalItems"       boolean NOT NULL DEFAULT false,
        "shippingAddress"       jsonb,
        "billingAddress"        jsonb,
        "gatewayTransactionRef" character varying(120),
        "notes"                 text,
        "createdAt"             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_invoices_invoiceNumber" UNIQUE ("invoiceNumber")
      )
    `);

    // RESTRICT, not CASCADE: an invoice outlives the convenience of deleting
    // an order. Removing an invoiced order should fail and make someone think.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "invoices"
          ADD CONSTRAINT "FK_invoices_order"
          FOREIGN KEY ("order_id") REFERENCES "orders"("order_id")
          ON DELETE RESTRICT ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "invoices"
          ADD CONSTRAINT "FK_invoices_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE RESTRICT ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_invoices_status" ON "invoices" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_invoices_invoiceDate" ON "invoices" ("invoiceDate")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_invoices_user_id" ON "invoices" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_invoiceNumber" ON "invoices" ("invoiceNumber")`,
    );

    // ── invoice_items ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "invoice_items" (
        "id"                     uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoice_id"             uuid NOT NULL,
        "order_item_id"          integer,
        "book_format_variant_id" integer,
        "title"                  character varying(255) NOT NULL,
        "format"                 "public"."invoice_items_format_enum" NOT NULL,
        "itemType"               "public"."invoice_items_itemtype_enum" NOT NULL,
        "sku"                    character varying(100),
        "fileDeliveryUrl"        text,
        "requiresShipping"       boolean NOT NULL DEFAULT false,
        "quantity"               integer NOT NULL,
        "unitPrice"              numeric(10,2) NOT NULL,
        "totalPrice"             numeric(10,2) NOT NULL,
        "taxRate"                numeric(5,2) NOT NULL DEFAULT 0,
        "taxAmount"              numeric(10,2) NOT NULL DEFAULT 0,
        "discountAmount"         numeric(10,2) NOT NULL DEFAULT 0,
        "createdAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoice_items" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "invoice_items"
          ADD CONSTRAINT "FK_invoice_items_invoice"
          FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // SET NULL on both audit links: losing the pointer back to the order line
    // or the variant must not destroy the invoiced line itself, which carries
    // its own frozen title/format/price snapshot precisely so it can stand
    // alone.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "invoice_items"
          ADD CONSTRAINT "FK_invoice_items_order_item"
          FOREIGN KEY ("order_item_id") REFERENCES "order_items"("order_item_id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "invoice_items"
          ADD CONSTRAINT "FK_invoice_items_variant"
          FOREIGN KEY ("book_format_variant_id") REFERENCES "book_format_varients"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoice_items_invoice_id" ON "invoice_items" ("invoice_id")`,
    );

    // ── invoice_daily_counters ─────────────────────────────────────────────
    // Backs `InvoiceNumberProvider`'s `INSERT … ON CONFLICT (date) DO UPDATE`.
    // The primary key on `date` IS the conflict target that makes the counter
    // atomic, so it is not optional decoration.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "invoice_daily_counters" (
        "date"    date NOT NULL,
        "counter" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_invoice_daily_counters" PRIMARY KEY ("date")
      )
    `);
  }

  /**
   * DESTRUCTIVE. Dropping these tables destroys financial records, and on a
   * database where `synchronize` created them this `down()` removes tables the
   * corresponding `up()` never made. It exists so the migration is reversible
   * in development and CI; do not run it against anything with real invoices in
   * it.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_daily_counters"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoices"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."invoice_items_format_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."invoice_items_itemtype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."invoices_status_enum"`);
  }
}
