import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Invoice }        from '@app/contract/invoices/entities/invoice.entity';
import { InvoiceItem }    from '@app/contract/invoices/entities/invoice-item.entity';
import { InvoiceDailyCounter } from '@app/contract/invoices/entities/invoice-daily-counter.entity';
import { InvoiceStatus }  from '@app/contract/invoices/enums/invoice-status.enum';
import { InvoiceItemType } from '@app/contract/invoices/enums/invoice-item-type.enum';
import { Order }          from '@app/contract/orders/entities/order.entity';

import { CreateInvoiceDto }      from '@app/contract/invoices/dtos/create-invoice.dto';
import { CreateInvoiceItemDto }  from '@app/contract/invoices/dtos/create-invoice-item.dto';
import { ListInvoicesQueryDto }  from '@app/contract/invoices/dtos/list-invoices-query.dto';

import { PaginationProvider } from '../../common/pagination/providers/pagination.provider';
import { InvoiceNumberProvider } from './invoice-number.provider';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,

    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepo: Repository<InvoiceItem>,

    // Registered via forFeature so that autoLoadEntities picks it up
    @InjectRepository(InvoiceDailyCounter)
    private readonly _counterRepo: Repository<InvoiceDailyCounter>,

    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,

    private readonly dataSource: DataSource,
    private readonly paginationProvider: PaginationProvider,
    private readonly invoiceNumberProvider: InvoiceNumberProvider,
  ) {}

  // ── CREATE ────────────────────────────────────────────────────────────────

  async create(dto: CreateInvoiceDto): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Resolve the order and its buyer
      const order = await queryRunner.manager.findOne(Order, {
        where: { id: dto.orderId },
        relations: ['user'],
      });

      if (!order) {
        throw new NotFoundException(`Order #${dto.orderId} not found.`);
      }

      if (!order.user) {
        throw new BadRequestException(
          `Order #${dto.orderId} has no associated user and cannot be invoiced.`,
        );
      }

      // 2. Classify item types and derive convenience flags
      const hasPhysicalItems = dto.items.some(
        (i) => i.itemType === InvoiceItemType.TANGIBLE,
      );
      const hasDigitalItems = dto.items.some(
        (i) => i.itemType === InvoiceItemType.INTANGIBLE,
      );

      // Guard: the DTO @ValidateIf should catch this, but a service-level check
      // is the last line of defence before any data reaches the database.
      if (hasPhysicalItems && !dto.shippingAddress) {
        throw new BadRequestException(
          'shippingAddress is required when the invoice contains tangible (physical) items.',
        );
      }

      // 3. Compute per-item financials
      const itemEntities = dto.items.map((itemDto) =>
        this.buildInvoiceItem(itemDto),
      );

      // 4. Compute invoice-level totals
      const subtotal = itemEntities.reduce(
        (sum, item) => sum + parseFloat(item.totalPrice),
        0,
      );

      // If an invoice-level taxRate is supplied it takes precedence;
      // otherwise fall back to summing per-item tax amounts.
      const taxAmount =
        dto.taxRate !== undefined
          ? subtotal * (dto.taxRate / 100)
          : itemEntities.reduce(
              (sum, item) => sum + parseFloat(item.taxAmount),
              0,
            );

      const discountAmount = dto.discountAmount ?? 0;
      const totalAmount    = subtotal + taxAmount - discountAmount;

      // 5. Generate a race-condition-safe invoice number
      const invoiceNumber = await this.invoiceNumberProvider.generate(queryRunner);

      // 6. Persist the invoice header
      const invoice = queryRunner.manager.create(Invoice, {
        invoiceNumber,
        orderId:              order.id,
        userId:               order.user.id,
        status:               InvoiceStatus.DRAFT,
        invoiceDate:          dto.invoiceDate,
        dueDate:              dto.dueDate ?? null,
        currency:             dto.currency ?? 'INR',
        subtotal:             subtotal.toFixed(2),
        taxRate:              String(dto.taxRate ?? 0),
        taxAmount:            taxAmount.toFixed(2),
        discountAmount:       discountAmount.toFixed(2),
        totalAmount:          totalAmount.toFixed(2),
        hasPhysicalItems,
        hasDigitalItems,
        shippingAddress:      dto.shippingAddress ?? null,
        billingAddress:       dto.billingAddress  ?? null,
        gatewayTransactionRef: dto.gatewayTransactionRef ?? null,
        notes:                dto.notes ?? null,
      });

      const savedInvoice = await queryRunner.manager.save(Invoice, invoice);

      // 7. Persist line items linked to the invoice
      const linkedItems = itemEntities.map((item) => ({
        ...item,
        invoiceId: savedInvoice.id,
      }));

      await queryRunner.manager.save(InvoiceItem, linkedItems);

      await queryRunner.commitTransaction();

      this.logger.log(
        `Invoice ${savedInvoice.invoiceNumber} created for order #${order.id}`,
      );

      // Return fully hydrated invoice
      return this.findOneOrFail(savedInvoice.id);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ── LIST ──────────────────────────────────────────────────────────────────

  async findAll(query: ListInvoicesQueryDto) {
    const {
      status,
      sortBy    = 'createdAt',
      sortOrder = 'DESC',
      userId,
      orderId,
    } = query;

    const qb = this.invoiceRepo
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.user',  'user')
      .leftJoinAndSelect('invoice.order', 'order')
      .leftJoinAndSelect('invoice.items', 'items');

    if (status)  qb.andWhere('invoice.status  = :status',  { status });
    if (userId)  qb.andWhere('invoice.userId  = :userId',  { userId });
    if (orderId) qb.andWhere('invoice.orderId = :orderId', { orderId });

    qb.orderBy(`invoice.${sortBy}`, sortOrder);

    const [data, total] = await this.paginationProvider.paginateQuery(query, qb);

    const page  = query.page  ?? 1;
    const limit = query.limit ?? 10;

    return {
      message: 'Invoices retrieved successfully.',
      data,
      meta: {
        itemsPerPage: limit,
        totalItems:   total,
        currentPage:  page,
        totalPages:   Math.ceil(total / limit),
      },
    };
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────

  private buildInvoiceItem(dto: CreateInvoiceItemDto): InvoiceItem {
    const itemTotal   = dto.unitPrice * dto.quantity;
    const itemTaxRate = dto.taxRate ?? 0;
    const itemTax     = itemTotal * (itemTaxRate / 100);
    const itemDiscount = dto.discountAmount ?? 0;

    const item = this.invoiceItemRepo.create({
      orderItemId:         dto.orderItemId         ?? null,
      bookFormatVariantId: dto.bookFormatVariantId  ?? null,
      itemType:            dto.itemType,
      title:               dto.title,
      format:              dto.format,
      sku:                 dto.sku             ?? null,
      fileDeliveryUrl:     dto.fileDeliveryUrl ?? null,
      requiresShipping:    dto.itemType === InvoiceItemType.TANGIBLE,
      quantity:            dto.quantity,
      unitPrice:           dto.unitPrice.toFixed(2),
      totalPrice:          itemTotal.toFixed(2),
      taxRate:             itemTaxRate.toFixed(2),
      taxAmount:           itemTax.toFixed(2),
      discountAmount:      itemDiscount.toFixed(2),
    });

    return item;
  }

  private async findOneOrFail(id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id },
      relations: ['items', 'order', 'user'],
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found after creation — this is unexpected.`);
    }

    return invoice;
  }
}
