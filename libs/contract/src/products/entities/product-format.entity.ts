import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('product_formats')
export class ProductFormat {
  @PrimaryGeneratedColumn({ name: 'format_id' })
  id: number;

  @Column({ unique: true })
  name: string;
}
