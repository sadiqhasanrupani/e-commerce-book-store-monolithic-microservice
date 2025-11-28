import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCartItemDto {
  @ApiProperty({ example: 2, description: 'New quantity', minimum: 1 })
  @IsInt()
  @Min(1)
  qty: number;
}
