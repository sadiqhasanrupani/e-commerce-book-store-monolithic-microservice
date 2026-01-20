import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsString, IsUUID, IsInt, Min, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Single item in the merge request.
 * Frontend sends items from IndexedDB including optional local price snapshot.
 */
export class MergeCartItemDto {
  @ApiProperty({ example: 123, description: 'Book format variant ID' })
  @IsInt()
  bookFormatVariantId: number;

  @ApiProperty({ example: 2, description: 'Quantity to add', minimum: 1 })
  @IsInt()
  @Min(1)
  qty: number;

  @ApiPropertyOptional({
    example: 2999,
    description: 'Local price snapshot in cents (for price change detection). If omitted, price change is not reported.',
  })
  @IsOptional()
  @IsInt()
  localPriceCents?: number;
}

/**
 * Request DTO for merging guest cart into authenticated user's cart.
 * Called after login to sync local cart with backend.
 */
export class MergeCartRequestDto {
  @ApiProperty({
    description: 'Guest session ID to cleanup after merge',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID(4)
  @IsString()
  sessionId: string;

  @ApiProperty({
    description: 'Items from local cart to merge',
    type: [MergeCartItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MergeCartItemDto)
  items: MergeCartItemDto[];
}

/**
 * Conflict detail for items that could not be fully merged
 */
export class MergeConflictDto {
  @ApiProperty({ description: 'Book format variant ID that had a conflict' })
  bookFormatVariantId: number;

  @ApiProperty({
    description: 'Reason for the conflict',
    enum: ['out_of_stock', 'price_changed', 'unavailable'],
  })
  reason: 'out_of_stock' | 'price_changed' | 'unavailable';

  @ApiProperty({ description: 'Human-readable message' })
  message: string;

  @ApiProperty({
    description: 'Additional details about the conflict',
    required: false,
  })
  details?: {
    requested?: number;
    available?: number;
    oldPrice?: number;
    newPrice?: number;
  };
}

/**
 * Summary of what was merged
 */
export class MergeSummaryDto {
  @ApiProperty({ description: 'Number of unique items merged' })
  itemCount: number;

  @ApiProperty({ description: 'Total quantity added across all items' })
  totalAdded: number;
}

/**
 * Response DTO for cart merge operation
 */
export class MergeCartResponseDto {
  @ApiProperty({ description: 'The merged authenticated cart' })
  cart: {
    id: string;
    items: Array<{
      id: string;
      bookFormatVariantId: number;
      title: string;
      unitPrice: number;
      qty: number;
      image: string;
      subtotal: number;
    }>;
    subtotal: number;
    shipping: number;
    discount: number;
    total: number;
  };

  @ApiProperty({ description: 'Summary of what was merged', type: MergeSummaryDto })
  merged: MergeSummaryDto;

  @ApiProperty({
    description: 'List of items that could not be fully merged',
    type: [MergeConflictDto],
  })
  conflicts: MergeConflictDto[];
}
