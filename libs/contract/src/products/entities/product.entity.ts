import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ProductType } from './product-type.entity';
import { ProductFormat } from './product-format.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn({ name: 'product_id' })
  id: number;

  @ManyToOne(() => ProductType)
  type: ProductType;

  @ManyToOne(() => ProductFormat)
  format: ProductFormat;

  @Column()
  title: string;

  @Column()
  author: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price: number;

  @Column({ default: 'USD' })
  currency: string;

  @Column({ default: 0 })
  stock_quantity: number;

  @Column({ default: 0 })
  reserved_quantity: number;

  @Column({ type: 'text' })
  file_path: string;

  @Column({ type: 'text', nullable: true })
  image_url: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
