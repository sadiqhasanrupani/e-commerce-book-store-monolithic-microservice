import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { CartItem } from './cart-item.entity';
import { CartStatus } from '../enums/cart-status.enum';

@Entity('carts')
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_carts_user')
  @Column({ name: 'user_id' })
  userId: number;

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
