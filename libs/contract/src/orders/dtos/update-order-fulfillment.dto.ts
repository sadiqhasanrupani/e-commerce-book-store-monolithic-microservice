import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

import { FulfillmentStatus } from '../enums/order-status.enum';

/** Trim incoming free text, and collapse an all-whitespace value to undefined. */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * Body of `PATCH /admin/orders/:id/fulfillment`.
 *
 * A real class-validator DTO rather than the hand-filtered `Partial<>` shape
 * used by `BooksAdminController.updateStatus`: this endpoint drives a state
 * machine and sends customer-facing e-mail, so a malformed body must be a 400
 * before it reaches the service, not a surprise inside a transaction.
 *
 * The global `HybridValidationPipe` runs with `whitelist` +
 * `forbidNonWhitelisted`, so any property not declared here is rejected — an
 * admin cannot, for example, smuggle a `paymentStatus` through this endpoint.
 */
export class UpdateOrderFulfillmentDto {
  /**
   * Target state. `CANCELLED` is accepted by the enum but is never a legal
   * target here — cancellation is the customer's `POST /user/orders/:id/cancel`
   * flow and an admin cancel/refund is separate, unbuilt scope. Asking for it
   * comes back as 409 `FULFILLMENT_INVALID_TRANSITION`.
   */
  @ApiProperty({
    enum: FulfillmentStatus,
    description: 'Target fulfilment state. Only PROCESSING, SHIPPED and DELIVERED are reachable from this endpoint.',
    example: FulfillmentStatus.SHIPPED,
  })
  @IsEnum(FulfillmentStatus)
  fulfillmentStatus: FulfillmentStatus;

  /**
   * Courier name, typed by the admin. Required when moving to SHIPPED — a
   * shipped order with no carrier gives the customer a tracking e-mail with
   * nothing in it.
   */
  @ApiPropertyOptional({
    description: 'Courier name. Required when fulfillmentStatus is SHIPPED.',
    example: 'Delhivery',
  })
  // Deliberately NOT `@IsOptional()`: that decorator short-circuits every other
  // constraint when the value is undefined, which would silently defeat the
  // "required when SHIPPED" rule. `@ValidateIf` gives conditional-required
  // instead — validate when we are shipping, or when a value was supplied.
  @ValidateIf(
    (dto: UpdateOrderFulfillmentDto) =>
      dto.fulfillmentStatus === FulfillmentStatus.SHIPPED || dto.carrier !== undefined,
  )
  @Transform(trimToUndefined)
  @IsNotEmpty({ message: 'carrier is required when marking an order SHIPPED' })
  @IsString()
  @MaxLength(100)
  carrier?: string;

  /** Airway bill / consignment number. Required when moving to SHIPPED. */
  @ApiPropertyOptional({
    description: 'Carrier tracking / AWB number. Required when fulfillmentStatus is SHIPPED.',
    example: '1234567890123',
  })
  @ValidateIf(
    (dto: UpdateOrderFulfillmentDto) =>
      dto.fulfillmentStatus === FulfillmentStatus.SHIPPED || dto.trackingNumber !== undefined,
  )
  @Transform(trimToUndefined)
  @IsNotEmpty({ message: 'trackingNumber is required when marking an order SHIPPED' })
  @IsString()
  @MaxLength(100)
  trackingNumber?: string;

  /**
   * Optional deep link to the courier's tracking page. Validated as an http(s)
   * URL because it is rendered as an anchor in a customer e-mail and on the
   * storefront — a `javascript:` value must never get that far.
   */
  @ApiPropertyOptional({
    description: 'Optional courier tracking page URL (http/https only).',
    example: 'https://www.delhivery.com/track/package/1234567890123',
  })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(500)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  trackingUrl?: string;

  /** Free-text note recorded on the `order_status_logs` audit row. */
  @ApiPropertyOptional({ description: 'Note stored on the status-log audit row.', example: 'Handed to courier 4pm' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(500)
  comment?: string;
}
