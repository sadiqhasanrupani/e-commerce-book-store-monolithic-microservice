import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

import { Roles } from '../enums/roles.enum';
import { IsEnum } from 'class-validator';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: false })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'password_hash' })
  passwordHash?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'google_id' })
  googleId?: string | null;

  @Column({
    type: 'enum',
    enum: Roles,
    default: Roles.BUYER,
    nullable: false,
  })
  @IsEnum(Roles, { message: 'Role must be either BUYER or ADMIN' })
  role: Roles;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firstName?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastName?: string;

  @Column({ type: 'boolean', default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
