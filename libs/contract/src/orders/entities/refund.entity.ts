import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Transaction } from './transaction.entity';

export enum RefundStatus {
  INITIATED = 'INITIATED',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity('refunds')
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Transaction, (transaction) => transaction.refunds)
  transaction: Transaction;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: RefundStatus,
    default: RefundStatus.INITIATED,
  })
  status: RefundStatus;

  @Column({ type: 'jsonb', nullable: true })
  acquirer_data: any; // Stores RRN/ARN

  @CreateDateColumn()
  created_at: Date;
}
