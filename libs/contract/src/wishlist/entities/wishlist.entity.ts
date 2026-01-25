import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Book } from '../../books/entities/book.entity';
import { WishlistAddedFrom } from '../enums/wishlist-added-from.enum';

@Entity('wishlists')
@Unique('uq_wishlists_user_book', ['userId', 'bookId'])
export class Wishlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_wishlists_user')
  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Index('idx_wishlists_book')
  @Column({ name: 'book_id', type: 'uuid' })
  bookId: string;

  @Column({
    name: 'added_from',
    type: 'enum',
    enum: WishlistAddedFrom,
    default: WishlistAddedFrom.PDP,
  })
  addedFrom: WishlistAddedFrom;

  @Column({ name: 'notify_on_sale', type: 'boolean', default: false })
  notifyOnSale: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Book, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: Book;
}
