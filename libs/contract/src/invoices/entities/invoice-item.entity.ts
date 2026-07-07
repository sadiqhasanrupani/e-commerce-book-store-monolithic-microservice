import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Invoice }           from './invoice.entity';
import { OrderItem }         from '../../orders/entities/order-item.entity';
import { BookFormatVariant } from '../../books/entities/book-format-varient.entity';
import { BookFormat }        from '../../books/enums/book-format.enum';
import { InvoiceItemType }   from '../enums/invoice-item-type.enum';

@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne(() => Invoice, (inv) => inv.items, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ name: 'invoice_id' })
  invoiceId: string;

  // Soft audit link — SET NULL if the originating order item is deleted
  @ManyToOne(() => OrderItem, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'order_item_id' })
  orderItem: OrderItem | null;

  @Column({ name: 'order_item_id', nullable: true })
  orderItemId: number | null;

  // Soft audit link — SET NULL if the variant is deleted
  @ManyToOne(() => BookFormatVariant, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'book_format_variant_id' })
  bookFormatVariant: BookFormatVariant | null;

  @Column({ name: 'book_format_variant_id', nullable: true })
  bookFormatVariantId: number | null;

  // ── Immutable snapshots (frozen at invoice creation time) ─────────────────

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'enum', enum: BookFormat })
  format: BookFormat;

  @Column({ type: 'enum', enum: InvoiceItemType })
  itemType: InvoiceItemType;

  // Physical items: ISBN for traceability; null for digital items
  @Column({ type: 'varchar', length: 100, nullable: true })
  sku: string | null;

  // Digital items: delivery URL snapshot; null for physical items
  @Column({ type: 'text', nullable: true })
  fileDeliveryUrl: string | null;

  // Derived from itemType, stored explicitly to avoid downstream recalculation
  @Column({ default: false })
  requiresShipping: boolean;

  // ── Money ──────────────────────────────────────────────────────────────────

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  unitPrice: string;

  // quantity × unitPrice (before item-level tax/discount)
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  totalPrice: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  taxRate: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  taxAmount: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  discountAmount: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
