import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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

  /** Original price cents */
  @IsOptional()
  @IsInt()
  @Min(0)
  originalPriceCents?: number;

  /** Include Tax */
  @IsOptional()
  @IsBoolean()
  includeTax?: boolean;

  /**
   * Tax rate for this variant, as a percentage.
   *
   * This was missing while `CreateBookVariantDto` had it, and the global
   * pipe runs with `forbidNonWhitelisted`, so the admin panel's edit form --
   * which sends `taxPercentage` whenever `includeTax` is on -- was rejected
   * with a 400 rather than saving. Adding it here is only half the fix; the
   * update mapping in `books.service.ts` has to persist it too.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxPercentage?: number;

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
