import { ApiProperty } from '@nestjs/swagger';

export class CartItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bookFormatVariantId: number;

  @ApiProperty()
  title: string;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  qty: number;

  @ApiProperty()
  image: string;

  @ApiProperty()
  subtotal: number;
}

export class CartResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items: CartItemResponseDto[];

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  shipping: number;

  @ApiProperty()
  discount: number;

  @ApiProperty()
  total: number;
}
