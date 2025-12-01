import { IsString, IsOptional, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Fiction', description: 'Name of the category' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'fiction', description: 'Slug of the category' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  slug?: string;

  @ApiPropertyOptional({ example: '0-2 Years', description: 'Age group associated with the category' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  age_group?: string;

  @ApiPropertyOptional({ example: 'uuid-of-parent', description: 'ID of the parent category' })
  @IsUUID()
  @IsOptional()
  parent_id?: string;
}
