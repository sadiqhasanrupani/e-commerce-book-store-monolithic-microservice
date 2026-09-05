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

/**
 * Delivery state of a digital line as the storefront sees it.
 *
 * `PENDING` collapses two internal states the frontend has no use for: the
 * order is not paid yet, and the order is paid but the delivery e-mail has not
 * been claimed yet. Both mean "no download has been sent". Physical lines get
 * `null`, not `PENDING`.
 */
export type DigitalDeliveryDisplayStatus = 'PENDING' | 'SENDING' | 'DELIVERED' | 'FAILED';

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

  /**
   * True when this line is a digital format (ebook/pdf/epub/audiobook/…), i.e.
   * something delivered by e-mail and download rather than by shipping. The
   * frontend should branch on this rather than re-deriving it from `format`,
   * so the physical/digital rule lives in one place.
   */
  @ApiProperty({ description: 'Whether this line is a downloadable digital format' })
  isDigital: boolean;

  /**
   * Delivery state of the download e-mail. Always `null` for physical lines.
   */
  @ApiProperty({
    enum: ['PENDING', 'SENDING', 'DELIVERED', 'FAILED'],
    nullable: true,
    description: 'Digital delivery state; null for physical items',
  })
  deliveryStatus: DigitalDeliveryDisplayStatus | null;

  /** When the download e-mail was sent, ISO 8601. Null unless DELIVERED. */
  @ApiPropertyOptional({ nullable: true, description: 'ISO 8601 timestamp of successful delivery' })
  deliveredAt: string | null;

  /**
   * Bearer-authed API path that streams this line's material, or null when
   * there is nothing to download (physical line, or the order is not paid).
   *
   * A relative path, not an absolute URL: the storefront already knows its own
   * API base, and the value must be fetched with the user's access token
   * attached, so it is not something that can be dropped into an `href`.
   */
  @ApiProperty({ nullable: true, description: 'Relative API path to download this item (requires bearer token)' })
  downloadUrl: string | null;
}

export type OrderDisplayStatus = 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

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

  /**
   * Shipping charged on this order, in MINOR units (paise) like `total` and
   * `items[].price`. Already included in `total` — show it as a breakdown line,
   * never add it on top.
   *
   * 0 for digital-only orders and for every order placed before shipping was
   * charged.
   */
  @ApiProperty({ description: 'Shipping charged, in paise. Already included in `total`.', example: 4900 })
  shippingCost: number;

  /**
   * Manual shipment details entered by an admin. All null until the order is
   * marked SHIPPED, and always null for digital-only orders.
   */
  @ApiProperty({ nullable: true, description: 'Courier name', example: 'Delhivery' })
  carrier: string | null;

  @ApiProperty({ nullable: true, description: 'Courier tracking / AWB number', example: '1234567890123' })
  trackingNumber: string | null;

  @ApiProperty({ nullable: true, description: 'Courier tracking page URL, if the admin supplied one' })
  trackingUrl: string | null;

  /** ISO 8601 timestamp of the first transition into SHIPPED. Null before that. */
  @ApiProperty({ nullable: true, description: 'ISO 8601 timestamp the order was marked shipped' })
  shippedAt: string | null;

  /** ISO 8601 timestamp of the first transition into DELIVERED. Null before that. */
  @ApiProperty({ nullable: true, description: 'ISO 8601 timestamp the order was marked delivered' })
  deliveredAt: string | null;
}
