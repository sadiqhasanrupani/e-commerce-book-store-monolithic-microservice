import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { BookFormat } from '../enums/book-format.enum';

export class CreateBookVariantDto {
  /** Format: PDF, EPUB, PHYSICAL, DOCX, WORKSHEET, etc. */
  @IsEnum(BookFormat)
  format: BookFormat;

  /** Price in cents (integer only to avoid float issues). */
  @IsInt()
  @Min(0)
  priceCents: number;

  /** Stock (physical only). */
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  /** Optional file URL for digital items. */
  @IsOptional()
  @IsString()
  fileUrl?: string;

  /** Optional ISBN for physical books. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  isbn?: string;

  /** For previewing pages */
  @IsOptional()
  @IsInt()
  @Min(0)
  previewPageCount?: number;

  /** Optional preview file */
  @IsOptional()
  @IsString()
  previewFileUrl?: string;

  /** Optional weight in grams */
  @IsOptional()
  @IsInt()
  @Min(0)
  weightG?: number;
}
