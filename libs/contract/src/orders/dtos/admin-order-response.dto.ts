import { ApiProperty } from '@nestjs/swagger';

import { OrderResponseDto } from './order-response.dto';

/**
 * The slice of the buyer an admin needs in order to work a fulfilment queue.
 *
 * Deliberately three fields. The `User` entity carries `passwordHash`,
 * `googleId`, `status` and more, none of which belong in an orders payload —
 * this DTO exists so the entity can never be spread into the response by
 * accident.
 */
export class AdminOrderCustomerDto {
  @ApiProperty({ description: 'Customer user id', example: 42 })
  id: number;

  @ApiProperty({ description: 'Customer e-mail (also the shipment notification address)' })
  email: string;

  /** First + last name joined, or an empty string when the profile has neither. */
  @ApiProperty({ description: 'Customer display name; empty string when unknown', example: 'Ada Lovelace' })
  name: string;
}

/**
 * Response for the `admin/orders` endpoints: everything the customer sees plus
 * who placed the order.
 *
 * Extending `OrderResponseDto` is intentional — the admin panel and the
 * storefront then agree on field names and units (money in paise, timestamps
 * ISO 8601), so a change to one is a change to both and they cannot drift.
 */
export class AdminOrderResponseDto extends OrderResponseDto {
  @ApiProperty({ type: AdminOrderCustomerDto })
  customer: AdminOrderCustomerDto;
}

/** Pagination meta for the admin orders list — identical keys to the storefront envelope. */
export class AdminOrdersPaginationMetaDto {
  @ApiProperty({ example: 137 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 7 })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNextPage: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage: boolean;
}

/** `{ data, meta }` envelope returned by `GET /admin/orders`. */
export class PaginatedAdminOrdersResponseDto {
  @ApiProperty({ type: [AdminOrderResponseDto] })
  data: AdminOrderResponseDto[];

  @ApiProperty({ type: AdminOrdersPaginationMetaDto })
  meta: AdminOrdersPaginationMetaDto;
}
