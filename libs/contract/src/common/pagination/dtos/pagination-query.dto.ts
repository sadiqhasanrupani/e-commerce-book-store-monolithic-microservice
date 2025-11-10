import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, IsPositive } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({
    name: 'limit',
    type: 'number',
    example: 1,
    description: 'The number of items per page',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  limit?: number;

  @ApiPropertyOptional({
    name: 'page',
    type: 'number',
    example: 1,
    description: 'The page number',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  page?: number;
}

