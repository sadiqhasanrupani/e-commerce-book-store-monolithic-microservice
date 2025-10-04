import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { IsEnum, IsString, Length } from 'class-validator';
import { Gender } from '../enums/gender.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({
    type: 'varchar',
    length: 120,
    name: 'first_name',
    nullable: false,
  })
  @IsString()
  @Length(1, 120)
  firstName: string;

  @Column({
    type: 'varchar',
    length: 120,
    name: 'last_name',
    nullable: false,
  })
  @IsString()
  @Length(1, 120)
  lastName: string;

  @Column({
    type: 'varchar',
    length: 120,
    name: 'gender',
    nullable: false,
  })
  @IsEnum(Gender, { message: 'gender much be male, female or other' })
  gender: Gender;
}
