import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('gift_cards')
export class GiftCard {
  @PrimaryGeneratedColumn({ name: 'gift_card_id' })
  id: number;

  @Column({ unique: true })
  code: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  initial_amount: number;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  balance: number;

  @Column({ type: 'date', nullable: true })
  expiration_date: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
