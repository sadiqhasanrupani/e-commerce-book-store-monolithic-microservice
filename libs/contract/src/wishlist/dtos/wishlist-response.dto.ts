import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WishlistAddedFrom } from '../enums/wishlist-added-from.enum';

// Nested book response (subset of full book)
class WishlistBookDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  authorName: string;

  @ApiProperty()
  coverImageUrl: string;

  @ApiPropertyOptional()
  slug?: string;
}

// Single wishlist item response
export class WishlistItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bookId: string;

  @ApiProperty({ type: WishlistBookDto })
  book: WishlistBookDto;

  @ApiProperty({ enum: WishlistAddedFrom })
  addedFrom: WishlistAddedFrom;

  @ApiProperty()
  notifyOnSale: boolean;

  @ApiProperty()
  createdAt: Date;
}

// Paginated response
export class WishlistPaginatedResponseDto {
  @ApiProperty({ type: [WishlistItemResponseDto] })
  items: WishlistItemResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

// Check wishlist response
export class WishlistCheckResponseDto {
  @ApiProperty()
  inWishlist: boolean;

  @ApiPropertyOptional()
  id?: string;
}
