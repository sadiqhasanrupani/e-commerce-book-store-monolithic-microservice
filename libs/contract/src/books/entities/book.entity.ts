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

  @Column({ type: 'varchar', length: 255, unique: true })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: BookGenre })
  genre: BookGenre;

  @Column({ type: 'enum', enum: BookFormat })
  format: BookFormat;

  @Column({ type: 'enum', enum: BookAvailability })
  availability: BookAvailability;

  @Column({ type: 'int', name: 'author_id' })
  authorId: number;

  @Column({ type: 'varchar', length: 255 })
  authorName: string;

  @Column({ type: 'date' })
  publishedDate: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'decimal', precision: 2, scale: 1 })
  rating: number;

  /** Book file URL (PDF or ePub stored in MinIO or CDN) */
  @Column('text', { array: true, nullable: true })
  fileUrl: string[] | null;

  /**
   * Snapshot URLs generated from the first pages of the PDF/books
   * */
  @Column('text', {
    array: true,
    nullable: true,
    name: 'snapshot_urls',
  })
  snapshotUrl: string[] | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  /**
   * Many books to one author
   * */
  @ManyToOne(() => Author, (author) => author.books)
  @JoinColumn({ name: 'author_id' })
  author: Author;
}
