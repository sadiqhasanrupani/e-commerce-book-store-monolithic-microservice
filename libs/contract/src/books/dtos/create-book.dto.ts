import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
  ValidateNested,
  IsInt,
  Min,
  Max,
  IsArray,
  IsBoolean,
} from 'class-validator';

import { Type } from 'class-transformer';
import { BookGenre } from '../enums/book-genres.enum';
import { BookFormat } from '../enums/book-format.enum';
import { BookAvailability } from '../enums/book-avaliability.enum';
import { CreateAuthorDto } from '../../author/dtos/create-author.dto';

/**
 * DTO for creating a new book.
 * Matches frontend validation and backend entity structure.
 */
export class CreateBookDto {
  /** Title of the book (max 255 characters). */
  @IsString()
  @MaxLength(255)
  title: string;

  /** Description of the book (min 10 characters). */
  @IsString()
  description: string;

  /** Genre of the book (must be one of BookGenre enum). */
  @IsEnum(BookGenre)
  genre: BookGenre;

  /** Format of the book (EBOOK, PAPERBACK, HARDCOVER, etc.). */
  @IsArray()
  @IsEnum(BookFormat, { each: true })
  @Type(() => String)
  formats: BookFormat[];

  /** Availability status (AVAILABLE, OUT_OF_STOCK, PREORDER). */
  @IsEnum(BookAvailability)
  availability: BookAvailability;

  /** Optional existing author ID (if author already exists). */
  @IsOptional()
  @IsInt()
  @Min(1)
  authorId?: number;

  /** Optional nested author details for inline creation. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAuthorDto)
  author?: CreateAuthorDto;

  /** Name of the author (required for both new and existing authors). */
  // @IsOptional()
  @IsString()
  @MaxLength(100)
  authorName: string;

  /** Published date of the book (ISO string). */
  // @IsOptional()
  @IsDateString()
  publishedDate: string;

  /** Price (decimal up to 2 places, non-negative). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  /** Rating (decimal up to 1 place, between 0 and 5). */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(5)
  rating: number;

  /** Cover image file URL (uploaded to CDN / MinIO). */
  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;

  /** Array of snapshot URLs (5 for physical, 10 for eBook). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  snapshotUrls?: string[];

  /** Array of book file URLs (PDF, EPUB, DOCX, etc.). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bookFileUrls?: string[];

  /** Bestseller flag. */
  @IsOptional()
  @IsBoolean()
  isBestseller?: boolean;

  /** Featured flag. */
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  /** New release flag. */
  @IsOptional()
  @IsBoolean()
  isNewRelease?: boolean;

  /** Whether users can leave reviews. */
  @IsOptional()
  @IsBoolean()
  allowReviews?: boolean;

  /** Whether users can add to wishlist. */
  @IsOptional()
  @IsBoolean()
  allowWishlist?: boolean;

  /** Whether notifications are enabled for this book. */
  @IsOptional()
  @IsBoolean()
  enableNotifications?: boolean;

  /** Visibility status (public, private, draft). */
  @IsOptional()
  @IsEnum(['public', 'private', 'draft'], {
    message: 'Visibility must be either public, private, or draft',
  })
  visibility?: 'public' | 'private' | 'draft';
}
