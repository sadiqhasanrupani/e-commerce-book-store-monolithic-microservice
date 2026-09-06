import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes "one invoice per order" a database rule.
 *
 * ## Why this has to be in the schema, not in the service
 *
 * Payment settlement now raises an invoice automatically, and settlement is
 * re-entered by design from three independent callers: the Razorpay webhook
 * (which the gateway redelivers on any non-2xx), the reconciliation cron (which
 * asks the gateway about payments no webhook arrived for), and the storefront's
 * `verifyOrder` poll. Two of those can be in flight for the same order at the
 * same moment.
 *
 * Application-level checks cannot close that on their own. "Does this order
 * already have an invoice?" and "insert one" are two statements, and two
 * processes can both pass the first before either runs the second. The other
 * post-payment claims in this codebase (digital delivery, physical fulfilment)
 * dodge that by folding the check and the write into one conditional UPDATE
 * executed under the order's row lock — but invoicing deliberately happens
 * AFTER the settlement transaction commits, outside that lock, because an
 * invoicing failure must never be able to roll back a payment we have taken.
 *
 * Outside the lock, the only thing that can serialise the two writers is the
 * database. Hence this constraint. `InvoiceIssuanceService` treats the
 * resulting `23505` as "someone else already invoiced this order" and sends no
 * e-mail, so the duplicate is not merely prevented — it produces the correct
 * behaviour.
 *
 * ## A unique INDEX rather than a table constraint
 *
 * `CREATE UNIQUE INDEX IF NOT EXISTS` is idempotent; `ALTER TABLE … ADD
 * CONSTRAINT` is not, and this migration has to be safe to run against a
 * database where `synchronize` has already been near these tables. The
 * enforcement is identical — Postgres implements a UNIQUE constraint as exactly
 * this index — and it doubles as the lookup index for
 * `InvoicesService.findAll`'s `orderId` filter and for the pre-insert existence
 * check.
 *
 * ## If this migration fails
 *
 * A failure here means the table already contains two or more invoices for the
 * same order, which can only have come from the pre-existing manual admin
 * endpoint (`POST /api/v1/invoices` has never checked). That is a real data
 * problem and must be resolved by a human deciding which invoice is the valid
 * one — the duplicates are financial documents that may already have been sent
 * to a customer, so this migration will not guess. To find them:
 *
 *   SELECT "order_id", count(*), array_agg("invoiceNumber")
 *     FROM "invoices" GROUP BY "order_id" HAVING count(*) > 1;
 */
export class AddUniqueOrderIdToInvoices1765600100000 implements MigrationInterface {
  name = 'AddUniqueOrderIdToInvoices1765600100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoices_order_id" ON "invoices" ("order_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_invoices_order_id"`);
  }
}
