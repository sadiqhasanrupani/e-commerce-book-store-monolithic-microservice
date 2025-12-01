import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Book } from './book.entity';
import { BookFormat } from '../enums/book-format.enum';

@Entity('book_format_varients')
export class BookFormatVariant {
  @PrimaryGeneratedColumn()
  id: number;


  @ManyToOne(() => Book, (book) => book.formats, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: Book;

  /** enum: PDF, PHYSICAL, EPUB, DOCX, WORKSHEET, etc */
  @Column({ type: 'enum', enum: BookFormat })
  format: BookFormat;

  /** format specific type */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'jsonb', nullable: true })
  priceMap: Record<string, number>;

  /** stock only for physical item*/
  @Column({ type: 'int', default: 0 })
  stockQuantity: number;

  /** reserved stocks for checkout locks */
  @Column({ type: 'int', default: 0 })
  reservedQuantity: number;

  /** for digital items */
  @Column({ type: 'text', nullable: true })
  fileUrl?: string | null;

  /** for physical items: isbn, weight, etc */
  @Column({ type: 'varchar', length: 100, nullable: true })
  isbn?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
