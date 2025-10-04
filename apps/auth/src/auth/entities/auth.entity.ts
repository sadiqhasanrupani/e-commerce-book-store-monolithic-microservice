import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ApprovalStatus {
	PENDING = 'pending',
	APPROVED = 'approved',
}

@Entity('auth')
export class Auth {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ unique: true })
	email: string;

	@Column()
	password: string; // hashed

	@Column({ nullable: true })
	otp: string;

	@Column({ type: 'enum', enum: ApprovalStatus, default: ApprovalStatus.PENDING })
	approvalStatus: ApprovalStatus;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;
}
