import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Shipping address shape returned to the storefront. Mirrors the frontend
 * `SavedAddress` interface (magic-pages-bookstore-64 profile.types.ts).
 *
 * The order only snapshots the fields collected at checkout (AddressDto), so
 * some SavedAddress fields are best-effort: `postalCode` is mapped from the
 * snapshot's `pincode`, and `id`/`country`/`isDefault` are not captured at
 * checkout and are defaulted.
 */
export class OrderAddressResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  line1: string;

  @ApiPropertyOptional()
  line2?: string;

  @ApiProperty()
  city: string;

  @ApiProperty()
  state: string;

  @ApiProperty()
  postalCode: string;

  @ApiProperty()
  country: string;

  @ApiProperty()
  phone: string;

  @ApiProperty()
  isDefault: boolean;
}

/** Mirrors the frontend `OrderItem` interface. */
export class OrderItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bookTitle: string;

  @ApiProperty()
  bookCover: string;

  @ApiProperty()
  format: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  price: number;
}

export type OrderDisplayStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

/** Mirrors the frontend `Order` interface. */
export class OrderResponseDto {
  @ApiProperty({ description: 'Order id as a string' })
  id: string;

  @ApiProperty({ example: 'MP-000123' })
  orderNumber: string;

  @ApiProperty({ description: 'Order creation time, ISO 8601 string' })
  date: string;

  @ApiProperty({
    enum: ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
  })
  status: OrderDisplayStatus;

  @ApiProperty()
  total: number;

  @ApiProperty({ example: 'INR' })
  currency: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty({ type: OrderAddressResponseDto, nullable: true })
  shippingAddress: OrderAddressResponseDto | null;
}
