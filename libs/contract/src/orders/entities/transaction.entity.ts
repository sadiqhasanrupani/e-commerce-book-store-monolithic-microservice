import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Order } from './order.entity';
import { Refund } from './refund.entity';

export enum TransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.transactions)
  order: Order;

  @Column({ nullable: true })
  gateway_ref_id: string; // razorpay_order_id or merchantTransactionId

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount: number;

  @Column()
  currency: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({
    type: 'enum',
    enum: PaymentProvider,
  })
  provider: PaymentProvider;

  @Column({ type: 'jsonb', nullable: true })
  raw_request: any;

  @Column({ type: 'jsonb', nullable: true })
  raw_response: any;

  @OneToMany(() => Refund, (refund) => refund.transaction)
  refunds: Refund[];

  @Index()
  @Column({ nullable: true })
  idempotency_key: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
