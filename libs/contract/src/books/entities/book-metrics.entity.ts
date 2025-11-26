import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Index } from "typeorm";
import { Book } from "./book.entity";

@Entity("book_metrics")
export class BookMetric {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Book, book => book.metrics, { onDelete: "CASCADE" })
  book: Book;

  @Index("idx_book_metrics_book")
  @Column({ type: "uuid" })
  book_id: string;

  @Column({ default: 0 })
  views: number;

  @Column({ default: 0 })
  previews: number;

  @Column({ default: 0 })
  sales: number;

  @Column({ default: 0 })
  wishlist_adds: number;
}
