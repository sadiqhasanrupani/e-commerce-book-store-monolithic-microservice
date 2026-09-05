import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Order } from './order.entity';

import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { DigitalDeliveryStatus } from '../enums/digital-delivery-status.enum';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn({ name: 'order_item_id' })
  id: number;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  order: Order;

  @ManyToOne(() => BookFormatVariant)
  bookFormatVariant: BookFormatVariant;

  @Column()
  quantity: number;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  unit_price: number;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    generatedType: 'STORED',
    asExpression: '"quantity" * "unit_price"',
  })
  total_price: number;

  /**
   * Delivery state of this line, for *digital* formats only.
   *
   * NULL means one of three things, and the response DTO collapses the first
   * two into `PENDING`: the order is not paid yet, the item is digital and
   * delivery has not been attempted, or the item is physical (physical lines
   * never leave NULL — they are delivered by shipping, not email).
   *
   * This column is the idempotency gate for digital delivery. Settlement can
   * be re-entered by three different callers (webhook, reconciliation cron and
   * `verifyOrder`), so the delivery e-mail is guarded by a conditional UPDATE
   * on this column executed while the parent order row is write-locked — see
   * `DigitalDeliveryService.claimDeliverableItems`. Whichever caller wins the
   * lock claims the row; the losers match zero rows and send nothing.
   */
  @Column({
    name: 'digital_delivery_status',
    type: 'enum',
    enum: DigitalDeliveryStatus,
    nullable: true,
  })
  digital_delivery_status?: DigitalDeliveryStatus | null;

  /**
   * When the download e-mail for this line was accepted by the SMTP server.
   * Set together with `digital_delivery_status = DELIVERED`, and left NULL in
   * every other state (including FAILED).
   */
  @Column({ name: 'digital_delivered_at', type: 'timestamptz', nullable: true })
  digital_delivered_at?: Date | null;
}
