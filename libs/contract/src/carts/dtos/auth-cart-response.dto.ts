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

  /**
   * Tax already contained in `subtotal`, in the same MAJOR units.
   *
   * INCLUSIVE: a component of the numbers above, never an addition. Adding it
   * to `total` would double-charge the customer. Computed by `TaxService`, the
   * same class `CheckoutService` uses to stamp `orders.tax_amount`, so the
   * basket breakdown and the order record cannot disagree.
   */
  @ApiProperty({ description: 'Tax contained in subtotal (inclusive), major units.', example: 76.27 })
  tax: number;

  @ApiProperty()
  totalItems: number;

  @ApiProperty()
  totalQuantity: number;
}
