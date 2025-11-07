import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('discount_codes')
export class DiscountCode {
  @PrimaryGeneratedColumn({ name: 'code_id' })
  id: number;

  @Column({ unique: true })
  code: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'enum', enum: ['percentage', 'fixed'] })
  discount_type: 'percentage' | 'fixed';

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  discount_value: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  min_order_amount: number;

  @Column({ type: 'date', nullable: true })
  valid_from: Date;

  @Column({ type: 'date', nullable: true })
  valid_until: Date;

  @Column({ default: 0 })
  usage_limit: number;

  @Column({ default: 0 })
  usage_count: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
