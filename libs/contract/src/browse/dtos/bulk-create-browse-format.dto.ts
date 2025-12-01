import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { CreateBrowseFormatDto } from './create-browse-format.dto';

export class BulkCreateBrowseFormatDto {
  @ApiProperty({ type: [CreateBrowseFormatDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => CreateBrowseFormatDto)
  formats: CreateBrowseFormatDto[];
}
