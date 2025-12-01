import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize, IsUUID, IsNotEmpty } from 'class-validator';
import { UpdateCategoryDto } from './update-category.dto';

export class UpdateCategoryWithIdDto extends UpdateCategoryDto {
  @ApiProperty({ example: 'uuid-1', description: 'ID of the category' })
  @IsUUID()
  @IsNotEmpty()
  id: string;
}

export class BulkUpdateCategoryDto {
  @ApiProperty({ type: [UpdateCategoryWithIdDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => UpdateCategoryWithIdDto)
  categories: UpdateCategoryWithIdDto[];
}
