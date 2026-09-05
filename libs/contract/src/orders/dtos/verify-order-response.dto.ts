import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TransactionStatus } from '../entities/transaction.entity';

/**
 * Minimal view of the order behind a verified payment.
 *
 * NOTE ON CASING — this is the one place in the API that intentionally returns
 * snake_case. Everywhere else the storefront gets camelCase via a response DTO
 * (`OrderResponseDto` and friends). `GET /user/orders/verify/:ref` shipped
 * returning the raw `Order` entity, and the deployed storefront's
 * `VerifiedOrderSummary` type (checkout/types/index.ts) reads
 * `total_amount` / `payment_status` / `fulfillment_status` / `created_at`
 * directly. Keeping those names is what makes this fix non-breaking.
 *
 * Even so, we no longer return the entity itself: an explicit DTO means the
 * `user` relation (and anything else hung off `Order` later) can never leak
 * into the response by accident.
 *
 * Follow-up: once the storefront moves to camelCase, replace this with
 * `OrderResponseDto` and delete the type.
 */
export class VerifiedOrderSummaryDto {
  @ApiProperty({ example: 42, description: 'Internal order id.' })
  id: number;

  @ApiProperty({ example: 499.0, description: 'Order total in major currency units.' })
  total_amount: number;

  @ApiProperty({ example: 'INR' })
  currency: string;

  @ApiProperty({ example: 'PAID', description: 'Order-level payment status.' })
  payment_status: string;

  @ApiProperty({ example: 'NOT_STARTED', description: 'Order-level fulfillment status.' })
  fulfillment_status: string;

  @ApiProperty({ example: '2026-08-19T10:00:00.000Z' })
  created_at: Date;
}

/**
 * Result of resolving a Razorpay order reference back to our payment state.
 *
 * `status` is the *transaction* status (PENDING / SUCCESS / FAILED), not the
 * order's display status — the storefront polls this until it leaves PENDING.
 */
export class VerifyOrderResponseDto {
  @ApiProperty({ enum: TransactionStatus, example: TransactionStatus.SUCCESS })
  status: TransactionStatus;

  @ApiPropertyOptional({
    type: VerifiedOrderSummaryDto,
    nullable: true,
    description: 'The order the payment belongs to. Null only if the transaction has no order attached.',
  })
  order: VerifiedOrderSummaryDto | null;
}
