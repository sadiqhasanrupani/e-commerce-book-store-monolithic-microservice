import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { PaginationQueryDto } from '../../common/pagination/dtos/pagination-query.dto';

/**
 * Query parameters for listing the authenticated user's orders.
 *
 * Extends the shared PaginationQueryDto but redeclares the fields with
 * `@Type(() => Number)` coercion (query-string values arrive as strings) and
 * sensible defaults, mirroring WishlistQueryDto.
 */
export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
