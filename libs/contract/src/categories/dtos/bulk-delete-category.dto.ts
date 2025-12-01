import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class BulkDeleteCategoryDto {
  @ApiProperty({ example: ['uuid-1', 'uuid-2'], description: 'Array of IDs to delete' })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  ids: string[];
}
