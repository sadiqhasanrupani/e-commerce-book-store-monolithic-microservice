import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';
import { Cart } from './cart.entity';
import { BookFormatVariant } from '../../books/entities/book-format-varient.entity';

@Entity('cart_items')
@Unique(['cartId', 'bookFormatVariantId'])
@Index('idx_cart_items_cart', ['cartId'])
export class CartItem {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'cart_id' })
    cart: Cart;

    @Column({ name: 'cart_id' })
    cartId: string;

    @ManyToOne(() => BookFormatVariant, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'book_variant_id' })
    bookFormatVariant: BookFormatVariant;

    @Column({ name: 'book_variant_id' })
    bookFormatVariantId: number;

    @Column({ type: 'int' })
    qty: number;

    @Column({ type: 'numeric', precision: 10, scale: 2, name: 'unit_price' })
    unitPrice: number;

    // Snapshot fields
    @Column({ length: 255, nullable: true })
    title: string;

    @Column({ type: 'text', nullable: true, name: 'cover_image_url' })
    coverImageUrl: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
