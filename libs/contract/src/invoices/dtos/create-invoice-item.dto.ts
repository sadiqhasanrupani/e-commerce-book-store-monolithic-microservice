import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { BookFormat }       from '../../books/enums/book-format.enum';
import { InvoiceItemType }  from '../enums/invoice-item-type.enum';

export class CreateInvoiceItemDto {
  // ── Optional soft-links ────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Source OrderItem ID for audit trail' })
  @IsInt()
  @IsPositive()
  @IsOptional()
  orderItemId?: number;

  @ApiPropertyOptional({ description: 'BookFormatVariant ID for audit trail' })
  @IsInt()
  @IsPositive()
  @IsOptional()
  bookFormatVariantId?: number;

  // ── Snapshot fields (caller provides; service may override from variant) ───

  @ApiProperty({ enum: InvoiceItemType, example: InvoiceItemType.TANGIBLE })
  @IsEnum(InvoiceItemType)
  itemType: InvoiceItemType;

  @ApiProperty({ example: 'The Magical Forest — Hardcover Edition' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ enum: BookFormat, example: BookFormat.HARDCOVER })
  @IsEnum(BookFormat)
  format: BookFormat;

  @ApiPropertyOptional({ description: 'ISBN for physical items', example: '978-3-16-148410-0' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({ description: 'Signed download URL for digital items' })
  @IsUrl()
  @IsOptional()
  fileDeliveryUrl?: string;

  // ── Quantity & pricing ─────────────────────────────────────────────────────

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 499.99, description: 'Price per unit in invoice currency' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice: number;

  @ApiPropertyOptional({ example: 18, description: 'Item-level GST rate (%)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({ example: 50, description: 'Item-level discount in currency units' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discountAmount?: number;
}
