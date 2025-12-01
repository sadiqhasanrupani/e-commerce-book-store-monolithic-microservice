import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class BulkDeleteAgeGroupDto {
  @ApiProperty({ example: ['3-5', '6-8'], description: 'Array of IDs to delete' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  ids: string[];
}
