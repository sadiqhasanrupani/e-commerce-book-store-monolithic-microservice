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
}
