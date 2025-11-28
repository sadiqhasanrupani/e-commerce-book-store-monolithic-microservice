import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('tags')
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 80, unique: true })
  name: string;
}
