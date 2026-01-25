
import { IsUUID, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WishlistAddedFrom } from '../enums/wishlist-added-from.enum';

export class AddToWishlistDto {
  @ApiProperty({
    description: 'Book ID to add to wishlist',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  bookId: string;

  @ApiPropertyOptional({
    description: 'Source of the add action (for analytics)',
    enum: WishlistAddedFrom,
    default: WishlistAddedFrom.PDP,
  })
  @IsOptional()
  @IsEnum(WishlistAddedFrom)
  addedFrom?: WishlistAddedFrom;
}
