import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { CreateBrowseCollectionDto } from './create-browse-collection.dto';

export class BulkCreateBrowseCollectionDto {
  @ApiProperty({ type: [CreateBrowseCollectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => CreateBrowseCollectionDto)
  collections: CreateBrowseCollectionDto[];
}
