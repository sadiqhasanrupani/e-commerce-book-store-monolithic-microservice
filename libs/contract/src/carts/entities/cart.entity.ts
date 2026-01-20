import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { CartItem } from './cart-item.entity';
import { CartStatus } from '../enums/cart-status.enum';

@Entity('carts')
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * User ID for authenticated carts.
   * Nullable to support guest carts (where sessionId is set instead).
   * Database CHECK constraint ensures exactly one of userId/sessionId is set.
   */
  @Index('idx_carts_user')
  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId: number | null;

  /**
   * Session ID for guest carts (frontend-generated UUID).
   * Nullable to support authenticated carts (where userId is set instead).
   * Database CHECK constraint ensures exactly one of userId/sessionId is set.
   */
  @Index('idx_carts_session')
  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  @Column({ type: 'enum', enum: CartStatus, default: CartStatus.ACTIVE })
  status: CartStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'checkout_started_at' })
  checkoutStartedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => CartItem, (item) => item.cart)
  items: CartItem[];
}

