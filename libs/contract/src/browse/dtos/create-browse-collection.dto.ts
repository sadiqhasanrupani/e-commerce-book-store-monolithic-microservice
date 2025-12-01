import { IsString, IsOptional, IsNumber, IsNotEmpty, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBrowseCollectionDto {
  @ApiProperty({ example: 'Bestsellers', description: 'Title of the collection' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Most loved by families', description: 'Description of the collection' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: '/search?filter=bestseller', description: 'Link to the collection' })
  @IsString()
  @IsNotEmpty()
  link: string;

  @ApiPropertyOptional({ example: 'trending-up', description: 'Icon identifier' })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ example: 'text-primary', description: 'Color theme class' })
  @IsString()
  @IsOptional()
  colorTheme?: string;

  @ApiPropertyOptional({ example: 1, description: 'Sort order' })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}
