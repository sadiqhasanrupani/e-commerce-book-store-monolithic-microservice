import { PartialType } from '@nestjs/mapped-types';
import { CreateBookDto } from './create-book.dto';
import { ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateAuthorDto } from '../../author/dtos/create-author.dto';

/**
 * Data Transfer Object for updating a book.
 *
 * Extends `CreateBookDto` with all fields optional, allowing partial updates.
 * Optionally supports updating the book's author by including an `author` object.
 */
export class UpdateBookDto extends PartialType(CreateBookDto) {
  /**
   * Optional nested author data.
   * If provided, allows updating the author information related to this book.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAuthorDto)
  author?: CreateAuthorDto;
}
