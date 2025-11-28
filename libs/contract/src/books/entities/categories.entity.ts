import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, Index } from 'typeorm';

@Entity('categories')
@Index('uq_categories_name', ['name'], { unique: true })
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 150, nullable: true })
  slug?: string;

  @Column({ length: 32, nullable: true })
  age_group?: string;

  @ManyToOne(() => Category, (category) => category.children, { onDelete: 'SET NULL' })
  parent?: Category;

  @Column({ type: 'uuid', nullable: true })
  parent_id?: string;

  @OneToMany(() => Category, (category) => category.parent)
  children: Category[];
}
