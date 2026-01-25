import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum WishlistSortBy {
  CREATED_AT = 'createdAt',
  BOOK_TITLE = 'bookTitle',
  PRICE = 'price',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class WishlistQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: WishlistSortBy, default: WishlistSortBy.CREATED_AT })
  @IsOptional()
  @IsEnum(WishlistSortBy)
  sortBy?: WishlistSortBy = WishlistSortBy.CREATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.DESC;
}
