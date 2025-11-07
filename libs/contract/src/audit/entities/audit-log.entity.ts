import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn()
  audit_id: number;

  @CreateDateColumn()
  timestamp: Date;

  @Column({ nullable: true })
  user_id: number;

  @Column()
  table_name: string;

  @Column()
  record_id: number;

  @Column()
  action: string;

  @Column({ type: 'jsonb', nullable: true })
  details: any;
}
