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

import { TRANSACTION_PROVIDERS, TransactionProvider } from '@app/contract/carts/enums/payment-provider.enum';

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

  /**
   * Gateway that handled the payment.
   *
   * Typed against `TRANSACTION_PROVIDERS` (which still contains `phonepe`)
   * rather than `PaymentProvider` (Razorpay-only) so that historical PhonePe
   * rows keep loading. New rows can only ever be `razorpay` — that is enforced
   * at the DTO/provider-selection layer, not here.
   */
  @Column({
    type: 'enum',
    enum: TRANSACTION_PROVIDERS,
    enumName: 'transactions_provider_enum',
  })
  provider: TransactionProvider;

  @Column({ type: 'jsonb', nullable: true })
  raw_request: any;

  @Column({ type: 'jsonb', nullable: true })
  raw_response: any;

  @OneToMany(() => Refund, (refund) => refund.transaction)
  refunds: Refund[];

  @Column({ nullable: true, unique: true })
  idempotency_key: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
