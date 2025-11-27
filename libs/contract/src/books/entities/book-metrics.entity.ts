import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Index } from "typeorm";
import { Book } from "./book.entity";

@Entity("book_metrics")
export class BookMetric {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Book, book => book.metrics, { onDelete: "CASCADE" })
  book: Book;

  @Column({ name: 'book_id', type: 'uuid' })
  bookId: string;

  @Column({ default: 0 })
  views: number;

  @Column({ type: 'timestamp', nullable: true })
  lastViewedAt: Date;

  @Column({ default: 0 })
  previews: number;

  @Column({ default: 0 })
  purchases: number;

  @Column({ type: 'timestamp', nullable: true })
  lastPurchasedAt: Date;

  @Column({ default: 0, name: 'wishlist_adds' })
  wishlistAdds: number;

  @Column({ default: 0 })
  downloads: number;

  @Column({ default: 0 })
  totalRatings: number;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  averageRating: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
