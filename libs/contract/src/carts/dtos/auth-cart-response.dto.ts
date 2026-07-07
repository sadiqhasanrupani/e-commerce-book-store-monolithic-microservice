import { ApiProperty } from '@nestjs/swagger';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';

export class AuthCartItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bookId: string;

  @ApiProperty()
  qty: number;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  total: number;

  @ApiProperty()
  title: string;

  @ApiProperty()
  coverImageUrl: string;

  @ApiProperty()
  variantId: number;

  @ApiProperty({ enum: BookFormat })
  format: BookFormat;
}

export class AuthCartResponseDto {
  @ApiProperty()
  cartId: string;

  @ApiProperty()
  userId: number;

  @ApiProperty({ type: [AuthCartItemResponseDto] })
  items: AuthCartItemResponseDto[];

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  totalItems: number;

  @ApiProperty()
  totalQuantity: number;
}
