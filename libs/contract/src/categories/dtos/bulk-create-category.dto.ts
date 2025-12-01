import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto';

export class BulkCreateCategoryDto {
  @ApiProperty({ type: [CreateCategoryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => CreateCategoryDto)
  categories: CreateCategoryDto[];
}
