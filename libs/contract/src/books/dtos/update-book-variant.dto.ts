import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { BookFormat } from '../enums/book-format.enum';

export class UpdateBookVariantDto {
  /** If id exists → update existing variant */
  @IsOptional()
  @IsInt()
  id?: number;

  /** Variant format (cannot be changed after creation ideally) */
  @IsOptional()
  @IsEnum(BookFormat)
  format?: BookFormat;

  /** Price in cents */
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  /** Stock for physical formats */
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  /** Digital file (URL) */
  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  isbn?: string;
}
