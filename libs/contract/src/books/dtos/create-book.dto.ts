import {
  IsEnum,
  IsString,
  MaxLength,
  IsOptional,
  IsArray,
  IsBoolean,
  ValidateNested,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BookGenre } from '../enums/book-genres.enum';
import { CreateAuthorDto } from '../../author/dtos/create-author.dto';
import { CreateBookVariantDto } from './create-book-variant.dto';

export class CreateBookDto {
  /** Title (required, unique constraint on DB level). */
  @IsString()
  @MaxLength(255)
  title: string;

  /** Optional subtitle. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subtitle?: string;

  /** Long description. */
  @IsOptional()
  @IsString()
  description?: string;

  /** Genre (Enum). */
  @IsOptional()
  @IsEnum(BookGenre)
  genre?: BookGenre;

  /** Optional existing author reference. */
  @IsOptional()
  @IsUUID()
  authorId?: string;

  /** Optional inline author creation. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAuthorDto)
  author?: CreateAuthorDto;

  /** Redundant authorName (stored in DB) for SEO & display indexing. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  authorName?: string;

  /** Slug for SEO (optional, auto-generated on backend). */
  @IsOptional()
  @IsString()
  slug?: string;

  /** Metadata (SEO) */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string;

  /** Cover image URL */
  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;

  /** Snapshot URLs array */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  snapshotUrls?: string[];

  /** Visibility: public | private | draft */
  @IsOptional()
  @IsEnum(['public', 'private', 'draft'])
  visibility?: 'public' | 'private' | 'draft';

  /** Flags */
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

  /** Category IDs (UUIDs) */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  /** Tag IDs */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  tagIds?: string[];

  /** Format variants (PDF/EPUB/Physical variations) */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBookVariantDto)
  variants: CreateBookVariantDto[];
}
