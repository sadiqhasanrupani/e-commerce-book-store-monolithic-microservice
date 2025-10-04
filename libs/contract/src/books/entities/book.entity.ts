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

@Entity()
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

  @Column({ type: 'int' })
  authorId: number;

  @Column({ type: 'varchar', length: 255 })
  authorName: string;

  @Column({ type: 'date' })
  publishedDate: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'decimal', precision: 2, scale: 1 })
  rating: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @ManyToOne(() => Author, (author) => author.books)
  @JoinColumn({ name: 'author_id' })
  author: Author;
}
