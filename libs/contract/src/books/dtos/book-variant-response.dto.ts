import { ApiProperty } from '@nestjs/swagger';

export class BookPriceDto {
  @ApiProperty({ example: 1200.00 })
  amount: number;

  @ApiProperty({ example: 'INR' })
  currency: string;

  @ApiProperty({ example: '₹1,200.00' })
  display: string;
}

export class BookVariantResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  format: string;

  @ApiProperty()
  isPhysical: boolean;

  @ApiProperty({ type: BookPriceDto })
  price: BookPriceDto;

  @ApiProperty()
  stockQuantity: number;

  @ApiProperty()
  reservedQuantity: number;

  @ApiProperty({ nullable: true })
  fileUrl?: string;

  @ApiProperty({ nullable: true })
  isbn?: string;

  /**
   * Whether an admin explicitly ticked "Include Tax" on this variant.
   * The storefront uses this to gate ALL tax wording (e.g. "Inclusive of all
   * taxes") — it must say nothing about tax unless this is `true`.
   */
  @ApiProperty({ example: false })
  includeTax: boolean;

  /**
   * Tax rate in percent (e.g. 18 for 18%). Only present when `includeTax` is
   * `true`; omitted otherwise so the storefront never shows a stray rate.
   */
  @ApiProperty({ nullable: true, example: 18 })
  taxPercentage?: number;
}
