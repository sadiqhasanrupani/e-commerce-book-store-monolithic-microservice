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
} from 'class-validator';
import { Type } from 'class-transformer';
import { BookGenre } from '../enums/book-genres.enum';
import { BookFormat } from '../enums/book-format.enum';
import { BookAvailability } from '../enums/book-avaliability.enum';
import { CreateAuthorDto } from '../../author/dtos/create-author.dto';

/**
 * Data Transfer Object for creating a new book.
 *
 * Supports specifying either an existing author via `authorId`
 * or creating a new author inline via the `author` object.
 */
export class CreateBookDto {
  /** Title of the book (max 255 characters). */
  @IsString()
  @MaxLength(255)
  title: string;

  /** Description of the book. */
  @IsString()
  description: string;

  /** Genre of the book (must be one of BookGenre enum). */
  @IsEnum(BookGenre)
  genre: BookGenre;

  /** Format of the book (must be one of BookFormat enum). */
  @IsEnum(BookFormat)
  format: BookFormat;

  /** Availability status of the book (must be one of BookAvailability enum). */
  @IsEnum(BookAvailability)
  availability: BookAvailability;

  /**
   * Optional existing author ID.
   * Use this if the author already exists in the database.
   */
  @IsOptional()
  @IsInt()
  authorId: number;

  /**
   * Optional nested author details.
   * Use this to create a new author inline while creating the book.
   */
  @ValidateNested()
  @Type(() => CreateAuthorDto)
  @IsOptional()
  author?: CreateAuthorDto;

  /** Name of the author (required for both new and existing authors). */
  @IsString()
  authorName: string;

  /** Published date of the book (ISO date string). */
  @IsDateString()
  publishedDate: string;

  /** Price of the book (decimal, max 2 decimal places). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  /** Rating of the book (decimal, 1 decimal place, min 0, max 5). */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsArray()
  fileUrls?: string[];

  /**
   * Snapshots for the first image url
   * For E-Book: 10 snapshots are needed
   * For Physical Book: 5 snapshots are needed.
   * */

  @IsOptional()
  @IsArray()
  snapshotUrls?: string[];
}
