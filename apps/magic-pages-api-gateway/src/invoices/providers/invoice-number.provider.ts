import { Injectable, Logger } from '@nestjs/common';
import { QueryRunner } from 'typeorm';

/**
 * Generates collision-free, human-readable invoice numbers.
 *
 * Format: INV-YYYYMMDD-XXXX  (e.g. INV-20240501-0042)
 *
 * Race-condition handling strategy
 * ---------------------------------
 * A single PostgreSQL statement is used:
 *
 *   INSERT INTO invoice_daily_counters (date, counter) VALUES ($1, 1)
 *   ON CONFLICT (date) DO UPDATE
 *     SET counter = invoice_daily_counters.counter + 1
 *   RETURNING counter;
 *
 * Because ON CONFLICT DO UPDATE is a single atomic command in PostgreSQL
 * (internally implemented as a "conditional upsert"), two concurrent
 * transactions will never read the same counter value for the same date —
 * one will block on the row lock until the other commits or rolls back.
 * No explicit advisory lock or SERIALIZABLE isolation is required.
 *
 * The call MUST be made inside an existing QueryRunner transaction so that
 * an invoice-creation failure automatically rolls back the counter increment.
 */
@Injectable()
export class InvoiceNumberProvider {
  private readonly logger = new Logger(InvoiceNumberProvider.name);

  async generate(queryRunner: QueryRunner): Promise<string> {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const dateToken = today.replace(/-/g, '');            // 'YYYYMMDD'

    const rows: Array<{ counter: number }> = await queryRunner.query(
      `INSERT INTO invoice_daily_counters (date, counter)
       VALUES ($1, 1)
       ON CONFLICT (date) DO UPDATE
         SET counter = invoice_daily_counters.counter + 1
       RETURNING counter`,
      [today],
    );

    const counter = rows[0].counter;
    const padded  = String(counter).padStart(4, '0');
    const number  = `INV-${dateToken}-${padded}`;

    this.logger.debug(`Generated invoice number: ${number}`);
    return number;
  }
}
