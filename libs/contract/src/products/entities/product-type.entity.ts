import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('product_types')
export class ProductType {
  @PrimaryGeneratedColumn({ name: 'product_type_id' })
  id: number;

  @Column({ unique: true })
  name: string;
}
