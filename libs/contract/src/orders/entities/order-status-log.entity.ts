import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { Order } from './order.entity';
import { PaymentStatus, FulfillmentStatus } from '../enums/order-status.enum';
import { User } from '@app/contract/users/entities/user.entity';

@Entity('order_status_logs')
export class OrderStatusLog {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Order, (order) => order.status_logs, { onDelete: 'CASCADE' })
  order: Order;

  @Column({ type: 'enum', enum: PaymentStatus, nullable: true })
  payment_status: PaymentStatus;

  @Column({ type: 'enum', enum: FulfillmentStatus, nullable: true })
  fulfillment_status: FulfillmentStatus;

  @ManyToOne(() => User)
  changed_by: User;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @CreateDateColumn()
  changed_at: Date;
}
