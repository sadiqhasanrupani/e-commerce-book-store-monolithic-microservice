import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Tracks the rolling per-day invoice sequence used by InvoiceNumberProvider.
 * The atomic ON CONFLICT DO UPDATE upsert guarantees no two concurrent
 * requests ever receive the same counter value for a given date.
 */
@Entity('invoice_daily_counters')
export class InvoiceDailyCounter {
  // Stored as 'YYYY-MM-DD' string — PostgreSQL date type
  @PrimaryColumn({ type: 'date' })
  date: string;

  @Column({ type: 'int', default: 0 })
  counter: number;
}
