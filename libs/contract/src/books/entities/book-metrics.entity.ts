import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { Book } from './book.entity';

/**
 * BookMetrics Entity
 * --------------------
 * This entity captures user engagement and sales data for each book.
 * It supports real-time aggregation and historical trend analysis.
 *
 * Design Principles:
 * - **1:1 relation with Book** — ensures a single metrics record per book.
 * - **Denormalized numeric fields** — for faster dashboard queries.
 * - **Event-sourced extensibility** — allows future migration to Kafka/NATS event ingestion.
 * - **PostgreSQL tuning** — indexes for time-based queries, partial indexes on public books.
 */

@Entity({ name: 'book_metrics' })
@Check(`"average_rating" >= 0 AND "average_rating" <= 5`)
export class BookMetrics {
  @PrimaryGeneratedColumn('increment', { name: 'metric_id' })
  metricId: number;

  /** 
   * Reference to the book this metric belongs to.
   * Ensures metrics are deleted when a book is removed.
   */
  @OneToOne(() => Book, (book) => book.metrics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: Book;

  @Column({ name: 'book_id', type: 'int', unique: true })
  @Index('idx_book_metrics_book_id')
  bookId: number;

  /** Engagement counters */
  @Column({ type: 'int', default: 0 })
  views: number;

  @Column({ type: 'int', default: 0 })
  purchases: number;

  @Column({ type: 'int', default: 0, name: 'wishlist_adds' })
  wishlistAdds: number;

  @Column({ type: 'int', default: 0 })
  downloads: number;

  /** Rating aggregation */
  @Column({ name: 'average_rating', type: 'float', default: 0 })
  averageRating: number;

  @Column({ name: 'total_ratings', type: 'int', default: 0 })
  totalRatings: number;

  /** Last activity timestamps */
  @Column({ name: 'last_viewed_at', type: 'timestamp', nullable: true })
  lastViewedAt?: Date;

  @Column({ name: 'last_purchased_at', type: 'timestamp', nullable: true })
  lastPurchasedAt?: Date;

  /** Audit timestamps */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
