import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { IsString, Length } from 'class-validator';

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

  /*
  @Column({
    type: 'varchar',
    length: 120,
    name: 'gender',
    nullable: false
  })
  @IsEnum()
  */
}
