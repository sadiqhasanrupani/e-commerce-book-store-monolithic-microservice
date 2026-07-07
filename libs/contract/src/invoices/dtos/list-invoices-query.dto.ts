import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/dtos/pagination-query.dto';
import { InvoiceStatus }      from '../enums/invoice-status.enum';

const SORTABLE_FIELDS = ['createdAt', 'invoiceDate', 'totalAmount'] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus, description: 'Filter by invoice status' })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @ApiPropertyOptional({ enum: SORTABLE_FIELDS, default: 'createdAt' })
  @IsIn(SORTABLE_FIELDS)
  @IsOptional()
  sortBy?: SortableField;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsIn(['ASC', 'DESC'])
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC';

  @ApiPropertyOptional({ description: 'Filter invoices for a specific buyer (user ID)' })
  @IsInt()
  @IsPositive()
  @IsOptional()
  userId?: number;

  @ApiPropertyOptional({ description: 'Filter invoices for a specific order' })
  @IsInt()
  @IsPositive()
  @IsOptional()
  orderId?: number;
}
