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

  /**
   * Shipping charged on this order, in MAJOR units (rupees) like
   * `total_amount`. Already included in `total_amount` — it is stored
   * separately so the storefront and the invoice can show the breakdown, not so
   * it can be added again.
   *
   * Zero for digital-only orders and for every order placed before shipping
   * was charged at all.
   */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  shipping_cost: number;

  /**
   * Tax already contained in `total_amount`, in MAJOR units.
   *
   * Tax here is INCLUSIVE: this is a component OF the total, never an addition
   * to it. Adding it to `total_amount` would double-charge. Captured at
   * checkout from the locked variant rows and stored so the order and its
   * invoice can show the split without re-deriving it from a rate an admin may
   * since have changed.
   */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  tax_amount: number;

  /**
   * Manual, admin-entered shipment details. There is no courier API
   * integration: an admin types the carrier name and AWB into
   * `PATCH /admin/orders/:id/fulfillment` when the parcel goes out, and the
   * storefront renders them read-only.
   *
   * All three stay NULL for digital-only orders and for any order that has not
   * been marked SHIPPED yet.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  carrier: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  tracking_number: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  tracking_url: string | null;

  /**
   * When the order FIRST entered SHIPPED / DELIVERED. Stamped once and never
   * overwritten, so a repeated admin call cannot rewrite history.
   */
  @Column({ type: 'timestamptz', nullable: true })
  shipped_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at: Date | null;

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
