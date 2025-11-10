import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { BookAvailability } from '../enums/book-avaliability.enum';
import { BookFormat } from '../enums/book-format.enum';
import { BookGenre } from '../enums/book-genres.enum';
import { Author } from './author.entity';

@Entity({ name: 'books' })
export class Book {
  @PrimaryGeneratedColumn()
  id: number;

  /** Title of the book */
  @Column({ type: 'varchar', length: 255, unique: true })
  title: string;

  /** Description of the book */
  @Column({ type: 'text' })
  description: string;

  /** Genre (Fiction, Non-fiction, etc.) */
  @Column({ type: 'enum', enum: BookGenre })
  genre: BookGenre;

  /** Book format (EBOOK, PAPERBACK, HARDCOVER) */
  @Column({ type: 'enum', enum: BookFormat })
  format: BookFormat;

  /** Book availability (AVAILABLE, OUT_OF_STOCK, PREORDER) */
  @Column({ type: 'enum', enum: BookAvailability })
  availability: BookAvailability;

  /** Foreign key to the author */
  @Column({ type: 'int', name: 'author_id', nullable: true })
  authorId: number | null;

  /** Display name of the author */
  @Column({ type: 'varchar', length: 100 })
  authorName: string;

  /** Published date */
  @Column({ type: 'date' })
  publishedDate: Date;

  /** Price of the book (max 2 decimal places) */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  /** Rating of the book (max 1 decimal place, 0–5) */
  @Column({ type: 'decimal', precision: 2, scale: 1 })
  rating: number;

  /** Cover image URL (stored in CDN or object storage) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  coverImageUrl: string | null;

  /** Snapshot image URLs (array) */
  @Column('text', { array: true, nullable: true })
  snapshotUrls: string[] | null;

  /** File URLs (PDF, EPUB, DOCX, etc.) */
  @Column('text', { array: true, nullable: true })
  bookFileUrls: string[] | null;

  /** Bestseller flag */
  @Column({ type: 'boolean', default: false })
  isBestseller: boolean;

  /** Featured flag */
  @Column({ type: 'boolean', default: false })
  isFeatured: boolean;

  /** New release flag */
  @Column({ type: 'boolean', default: false })
  isNewRelease: boolean;

  /** Whether users can add reviews */
  @Column({ type: 'boolean', default: true })
  allowReviews: boolean;

  /** Whether users can add to wishlist */
  @Column({ type: 'boolean', default: true })
  allowWishlist: boolean;

  /** Whether users receive notifications about this book */
  @Column({ type: 'boolean', default: false })
  enableNotifications: boolean;

  /** Visibility setting */
  @Column({
    type: 'enum',
    enum: ['public', 'private', 'draft'],
    default: 'public',
  })
  visibility: 'public' | 'private' | 'draft';

  /** Timestamps */
  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  /** Many books belong to one author */
  @ManyToOne(() => Author, (author) => author.books, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author: Author | null;

  /**
     * Archival & Soft Deletion
     * - `isArchived` allows filtering books that are hidden from users but retained in DB.
     * - `archivedAt` records when the book was archived.
     * - `deletedAt` enables soft delete tracking (TypeORM’s `@DeleteDateColumn` is optional).
     */

  @Column({ type: 'boolean', default: false, name: "is_archived" })
  isArchived: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'archieve_at' })
  archivedAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'deleted_at' })
  deletedAt?: Date;
}
