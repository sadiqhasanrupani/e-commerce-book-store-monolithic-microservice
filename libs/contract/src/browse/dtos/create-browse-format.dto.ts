import { IsString, IsOptional, IsNumber, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBrowseFormatDto {
  @ApiProperty({ example: 'PDF', description: 'Label of the format' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ example: 'Instant digital downloads', description: 'Description of the format' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Read on any device', description: 'Benefit of the format' })
  @IsString()
  @IsOptional()
  benefit?: string;

  @ApiPropertyOptional({ example: 'file-text', description: 'Icon identifier' })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ example: 1, description: 'Sort order' })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}
