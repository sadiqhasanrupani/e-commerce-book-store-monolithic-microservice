import {
  Column,
  Entity,
  ManyToMany,
  PrimaryColumn,
} from 'typeorm';
import { Book } from '../../books/entities/book.entity';

@Entity('age_groups')
export class AgeGroup {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  id: string; // e.g., "3-5"

  @Column({ type: 'varchar', length: 50 })
  label: string; // e.g., "Ages 3-5"

  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'hero_image_url' })
  heroImage: string;

  @ManyToMany(() => Book, (book) => book.ageGroups)
  books: Book[];
}
