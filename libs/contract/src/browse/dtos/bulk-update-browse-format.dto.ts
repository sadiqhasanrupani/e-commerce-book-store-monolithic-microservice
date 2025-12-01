import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize, IsUUID, IsNotEmpty } from 'class-validator';
import { UpdateBrowseFormatDto } from './update-browse-format.dto';

export class UpdateBrowseFormatWithIdDto extends UpdateBrowseFormatDto {
  @ApiProperty({ example: 'uuid-1', description: 'ID of the format' })
  @IsUUID()
  @IsNotEmpty()
  id: string;
}

export class BulkUpdateBrowseFormatDto {
  @ApiProperty({ type: [UpdateBrowseFormatWithIdDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => UpdateBrowseFormatWithIdDto)
  formats: UpdateBrowseFormatWithIdDto[];
}
