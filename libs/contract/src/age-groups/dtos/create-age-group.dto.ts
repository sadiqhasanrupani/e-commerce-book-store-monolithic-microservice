import { IsString, IsNotEmpty, IsOptional, IsInt, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAgeGroupDto {
  @ApiProperty({ example: '3-5', description: 'Unique identifier for the age group' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  id: string;

  @ApiProperty({ example: 'Ages 3-5', description: 'Display label for the age group' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  label: string;

  @ApiPropertyOptional({ example: 1, description: 'Sort order for display' })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ example: 'Books for toddlers', description: 'Description of the age group' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg', description: 'Hero image URL' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  heroImage?: string;
}
