import { ApiProperty } from '@nestjs/swagger';

import { OrderResponseDto } from './order-response.dto';

/**
 * Pagination metadata for the orders list envelope.
 *
 * Uses the explicit total/page/limit/totalPages/hasNextPage/hasPreviousPage
 * keys that the storefront expects (matching the books-search `SearchMeta`
 * shape on the frontend). This intentionally does NOT reuse the shared
 * `Paginated<T>` interface in libs/contract/src/common/pagination, whose meta
 * keys (itermPerPage/totalItems/currentPage) do not match the FE contract.
 */
export class OrdersPaginationMetaDto {
  @ApiProperty({ description: 'Total number of orders for the user', example: 42 })
  total: number;

  @ApiProperty({ description: 'Current page (1-based)', example: 1 })
  page: number;

  @ApiProperty({ description: 'Page size applied', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 3 })
  totalPages: number;

  @ApiProperty({ description: 'Whether a next page exists', example: true })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether a previous page exists', example: false })
  hasPreviousPage: boolean;
}

/**
 * Envelope returned by GET /user/orders: a page of orders plus pagination meta.
 * Mirrors the `{ data, meta }` house style used by the transactions controller.
 */
export class PaginatedOrdersResponseDto {
  @ApiProperty({ type: [OrderResponseDto] })
  data: OrderResponseDto[];

  @ApiProperty({ type: OrdersPaginationMetaDto })
  meta: OrdersPaginationMetaDto;
}
