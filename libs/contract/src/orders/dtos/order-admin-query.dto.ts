import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { OrderQueryDto } from './order-query.dto';
import { FulfillmentStatus, PaymentStatus } from '../enums/order-status.enum';

/**
 * Query parameters for `GET /admin/orders`.
 *
 * Extends the customer-facing `OrderQueryDto` so page/limit coercion and the
 * 100-row ceiling are defined in exactly one place, and adds the filters the
 * admin fulfilment queue needs. There is deliberately no `userId` filter: an
 * admin browsing a specific customer's orders is a different feature, and
 * accepting a user id here would invite the frontend to treat it as an
 * ownership parameter.
 */
export class OrderAdminQueryDto extends OrderQueryDto {
  @ApiPropertyOptional({
    enum: FulfillmentStatus,
    description: 'Only orders in this fulfilment state (e.g. PROCESSING for the "to ship" queue).',
  })
  @IsOptional()
  @IsEnum(FulfillmentStatus)
  fulfillmentStatus?: FulfillmentStatus;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description: 'Only orders in this payment state. Pair with fulfillmentStatus=PROCESSING for the real ship queue.',
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /**
   * Free-text search across the order reference and the customer's e-mail.
   *
   * `MP-000042`, `42` and `buyer@example.com` all work: the service strips the
   * `MP-` prefix and leading zeros to recover the numeric id, and falls back to
   * an e-mail substring match.
   */
  @ApiPropertyOptional({ description: 'Order number (MP-000042 or 42) or customer e-mail substring.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  search?: string;
}
