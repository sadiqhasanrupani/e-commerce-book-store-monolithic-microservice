import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User }          from '../../users/entities/user.entity';
import { Order }         from '../../orders/entities/order.entity';
import { InvoiceItem }   from './invoice-item.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';

// ── Address snapshot types (stored as JSONB) ──────────────────────────────────
// These are frozen at invoice creation to preserve historical accuracy.

export interface ShippingAddressSnapshot {
  fullName:      string;
  addressLine1:  string;
  addressLine2?: string;
  city:          string;
  state:         string;
  postalCode:    string;
  country:       string;
  phone?:        string;
}

export interface BillingAddressSnapshot {
  fullName:      string;
  addressLine1:  string;
  addressLine2?: string;
  city:          string;
  state:         string;
  postalCode:    string;
  country:       string;
  email?:        string;
}

@Entity('invoices')
@Index(['status'])
@Index(['invoiceDate'])
@Index(['userId'])
/**
 * One invoice per order, enforced by the database.
 *
 * Payment settlement raises invoices automatically, and settlement is re-entered
 * by design from three callers (the Razorpay webhook, the reconciliation cron,
 * and the storefront's `verifyOrder` poll), two of which can be in flight for
 * the same order at once. Invoicing happens AFTER the settlement transaction
 * commits — deliberately, so an invoicing failure can never roll back a payment
 * — which puts it outside the order row lock that makes the other post-payment
 * claims exactly-once. Out there, only this constraint can serialise two
 * writers, so it is the actual guarantee rather than a belt-and-braces index.
 *
 * `InvoiceIssuanceService` treats the resulting `23505` as "already invoiced"
 * and sends no second e-mail. Named explicitly so `synchronize` (development)
 * and `1765600100000-AddUniqueOrderIdToInvoices` (migrations) create the same
 * object rather than two equivalent ones.
 */
@Index('UQ_invoices_order_id', ['orderId'], { unique: true })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Business-readable identifier — INV-YYYYMMDD-XXXX, unique, indexed
  @Column({ type: 'varchar', length: 32, unique: true })
  @Index()
  invoiceNumber: string;

  // ── Relations ─────────────────────────────────────────────────────────────

  @ManyToOne(() => Order, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'order_id' })
  orderId: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: number;

  @OneToMany(() => InvoiceItem, (item) => item.invoice, { cascade: true })
  items: InvoiceItem[];

  // ── Status & key dates ────────────────────────────────────────────────────

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @Column({ type: 'date' })
  invoiceDate: string;

  // null for digital-only invoices (instant delivery, no meaningful deadline)
  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  issuedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  // ── Money (numeric → string to avoid JS float rounding) ──────────────────

  @Column({ type: 'varchar', length: 3, default: 'INR' })
  currency: string;

  // Sum of all item.totalPrice before invoice-level tax / discount
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  subtotal: string;

  // Invoice-level tax rate (%) — may differ from per-item rates
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  taxRate: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  taxAmount: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  discountAmount: string;

  // subtotal + taxAmount - discountAmount
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  totalAmount: string;

  // ── Item-type convenience flags ────────────────────────────────────────────

  @Column({ default: false })
  hasPhysicalItems: boolean;

  @Column({ default: false })
  hasDigitalItems: boolean;

  // ── Addresses (JSONB snapshots) ────────────────────────────────────────────

  // Required when hasPhysicalItems is true; validated at service layer
  @Column({ type: 'jsonb', nullable: true })
  shippingAddress: ShippingAddressSnapshot | null;

  // Stored for legal / accounting purposes
  @Column({ type: 'jsonb', nullable: true })
  billingAddress: BillingAddressSnapshot | null;

  // ── Payment reference ──────────────────────────────────────────────────────

  // Razorpay order_id / payment_id for reconciliation
  @Column({ type: 'varchar', length: 120, nullable: true })
  gatewayTransactionRef: string | null;

  // ── Misc ──────────────────────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
