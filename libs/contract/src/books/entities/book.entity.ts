import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToMany,
  JoinTable,
  Index,
  DeleteDateColumn,
} from 'typeorm';

import { Author } from '@app/contract/author/entities/author.entity';
import { Tag } from './tags.entity';
import { BookFormatVariant } from './book-format-varient.entity';
import { Category } from './categories.entity';
import { BookMetric } from './book-metrics.entity';
import { AgeGroup } from '../../age-groups/entities/age-group.entity';

@Entity('books')
@Index('idx_books_title', ['title'], { unique: true })
@Index('idx_books_slug', ['slug'])
@Index('idx_books_age_group', ['ageGroup'])
export class Book {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  title: string;

  @Column({ length: 255, nullable: true })
  subtitle?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ length: 80, nullable: true })
  genre?: string;

  @ManyToOne(() => Author, (author) => author.books, { nullable: true, onDelete: 'SET NULL' })
  author?: Author;

  @Column({ type: 'uuid', nullable: true })
  authorId?: string;

  @Column({ length: 100, nullable: true })
  authorName?: string;

  @Column({ length: 255, nullable: true })
  coverImageUrl?: string;

  @Column({ type: 'text', array: true, nullable: true })
  snapshotUrls?: string[];



  @Column({ type: 'jsonb', nullable: true, default: [] })
  snapshots: string[];

  @Column({ length: 200, nullable: true })
  slug?: string;

  @Column({ length: 160, nullable: true })
  metaTitle?: string;

  @Column({ length: 500, nullable: true })
  metaDescription?: string;

  @Column({ default: false })
  isBestseller: boolean;

  @Column({ default: false })
  isFeatured: boolean;

  @Column({ default: false })
  isNewRelease: boolean;

  @Column({ default: true })
  allowReviews: boolean;

  @Column({ default: true })
  allowWishlist: boolean;

  @Column({ length: 10, default: 'public' })
  visibility: string;

  @Column({ length: 24, nullable: true })
  ageGroup?: string;

  @Column({ default: false })
  isArchived: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt?: Date;



  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ type: 'tsvector', nullable: true })
  tsv?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => BookFormatVariant, (variant) => variant.book)
  formats: BookFormatVariant[];

  @ManyToMany(() => Category)
  @JoinTable({ name: 'book_categories' })
  categories: Category[];

  @ManyToMany(() => Tag)
  @JoinTable({ name: 'book_tags' })
  tags: Tag[];

  @OneToMany(() => BookMetric, (metric) => metric.book)
  metrics: BookMetric[];

  @ManyToMany(() => AgeGroup, (ageGroup) => ageGroup.books)
  @JoinTable({ name: 'book_age_groups' })
  ageGroups: AgeGroup[];

  minPrice?: number;
}
