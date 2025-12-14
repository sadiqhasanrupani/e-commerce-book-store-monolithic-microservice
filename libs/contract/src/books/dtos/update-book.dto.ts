import { IsOptional, IsString, MaxLength, IsEnum, IsArray, ValidateNested, IsUUID, IsBoolean, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';
import { BookGenre } from '../enums/book-genres.enum';
import { UpdateBookVariantDto } from './update-book-variant.dto';

export class UpdateBookDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bullets?: string[];

  @IsOptional()
  @IsEnum(BookGenre)
  genre?: BookGenre;

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  authorName?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string;

  @IsOptional()
  @IsBoolean()
  isBestseller?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isNewRelease?: boolean;

  @IsOptional()
  @IsBoolean()
  allowReviews?: boolean;

  @IsOptional()
  @IsBoolean()
  allowWishlist?: boolean;

  @IsOptional()
  @IsEnum(['public', 'private', 'draft'])
  visibility?: 'public' | 'private' | 'draft';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsUrl({}, { each: true })
  snapshots?: string[];

  /** category ids */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  /** tag ids */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  tagIds?: string[];

  /** Age Group IDs (e.g. "3-5") */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ageGroupIds?: string[];

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  /** Hybrid variant update */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateBookVariantDto)
  variants?: UpdateBookVariantDto[];
}
