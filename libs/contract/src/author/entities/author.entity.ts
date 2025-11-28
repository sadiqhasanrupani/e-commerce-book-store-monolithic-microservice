import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Book } from '@app/contract/books/entities/book.entity';
import { StringBaseEntity } from '@app/contract/common/entities/string-base.entity';

@Entity('authors')
export class Author extends StringBaseEntity {
  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  bio?: string;

  @OneToMany(() => Book, (book) => book.author)
  books: Book[];
}
