import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '@app/contract/users/entities/user.entity';
import { OrderItem } from './order-item.entity';
import { OrderStatusLog } from './order-status-log.entity';
import { PaymentStatus, FulfillmentStatus } from '../enums/order-status.enum';
import { Transaction } from './transaction.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn({ name: 'order_id' })
  id: number;

  @ManyToOne(() => User)
  user: User;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  payment_status: PaymentStatus;

  @Column({ type: 'enum', enum: FulfillmentStatus, default: FulfillmentStatus.NOT_STARTED })
  fulfillment_status: FulfillmentStatus;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  total_amount: number;

  @Column({ nullable: true })
  discount_code: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  gift_card_amount: number;

  /**
   * Snapshot of the shipping address captured at checkout time, so the order
   * remains accurate even if the user later edits or deletes the address.
   * Nullable for backwards-compatibility with rows created before this column.
   */
  @Column({ type: 'jsonb', nullable: true })
  shipping_address: Record<string, any> | null;

  /** Currency the order total is denominated in. Defaults to INR. */
  @Column({ type: 'varchar', length: 3, default: 'INR' })
  currency: string;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];

  @OneToMany(() => OrderStatusLog, (log) => log.order)
  status_logs: OrderStatusLog[];

  @OneToMany(() => Transaction, (transaction) => transaction.order)
  transactions: Transaction[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
