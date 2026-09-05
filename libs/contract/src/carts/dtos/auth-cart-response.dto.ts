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

  /**
   * Flat-rate shipping the basket would be charged at checkout, in the same
   * MAJOR units as `subtotal` — zero for a cart with no physical line.
   * Computed by `ShippingRateService`, the exact same class
   * `CheckoutService` calls to build the Razorpay charge, so this quote and
   * the amount actually billed can never drift apart.
   */
  @ApiProperty({ description: 'Flat-rate shipping charge, major units. 0 for a digital-only cart.' })
  shipping: number;

  /** `subtotal + shipping`. What the storefront should show as the order total pre-checkout. */
  @ApiProperty({ description: 'subtotal + shipping, major units.' })
  total: number;

  @ApiProperty()
  totalItems: number;

  @ApiProperty()
  totalQuantity: number;
}
