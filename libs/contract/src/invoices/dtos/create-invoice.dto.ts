import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceItemType }     from '../enums/invoice-item-type.enum';
import { CreateInvoiceItemDto } from './create-invoice-item.dto';
import { ShippingAddressDto }   from './shipping-address.dto';
import { BillingAddressDto }    from './billing-address.dto';

export class CreateInvoiceDto {
  // ── Order reference ────────────────────────────────────────────────────────

  @ApiProperty({ description: 'ID of the Order this invoice is raised against', example: 42 })
  @IsInt()
  @IsPositive()
  orderId: number;

  // ── Line items ─────────────────────────────────────────────────────────────

  @ApiProperty({ type: [CreateInvoiceItemDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  // ── Dates ──────────────────────────────────────────────────────────────────

  @ApiProperty({ example: '2024-05-01', description: 'ISO date (YYYY-MM-DD)' })
  @IsDateString()
  invoiceDate: string;

  @ApiPropertyOptional({
    example: '2024-05-31',
    description: 'Payment due date. Omit for digital-only invoices.',
  })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  // ── Currency & money ───────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 'INR', default: 'INR' })
  @IsString()
  @MaxLength(3)
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({
    example: 18,
    description: 'Invoice-level tax rate (%). Applied on top of item subtotals when provided.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({
    example: 100,
    description: 'Invoice-level discount amount in currency units.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discountAmount?: number;

  // ── Addresses ──────────────────────────────────────────────────────────────

  /**
   * Business rule: shippingAddress is REQUIRED when any item is TANGIBLE.
   * @ValidateIf runs the subsequent validators only when the condition is true.
   * When all items are INTANGIBLE the field is silently optional.
   */
  @ApiPropertyOptional({
    type: ShippingAddressDto,
    description:
      'Required when the invoice contains at least one TANGIBLE (physical) item.',
  })
  @ValidateIf((dto: CreateInvoiceDto) =>
    dto.items?.some((i) => i.itemType === InvoiceItemType.TANGIBLE),
  )
  @IsNotEmpty({
    message: 'shippingAddress is required when the invoice contains tangible (physical) items.',
  })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  @IsOptional()
  shippingAddress?: ShippingAddressDto;

  @ApiPropertyOptional({ type: BillingAddressDto })
  @ValidateNested()
  @Type(() => BillingAddressDto)
  @IsOptional()
  billingAddress?: BillingAddressDto;

  // ── Payment & misc ────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: 'pay_QwErTy12345',
    description: 'Razorpay payment_id / order_id for reconciliation.',
  })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  gatewayTransactionRef?: string;

  @ApiPropertyOptional({ example: 'Replacement invoice for order #42.' })
  @IsString()
  @IsOptional()
  notes?: string;
}
