import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize, IsUUID, IsNotEmpty } from 'class-validator';
import { UpdateBrowseCollectionDto } from './update-browse-collection.dto';

export class UpdateBrowseCollectionWithIdDto extends UpdateBrowseCollectionDto {
  @ApiProperty({ example: 'uuid-1', description: 'ID of the collection' })
  @IsUUID()
  @IsNotEmpty()
  id: string;
}

export class BulkUpdateBrowseCollectionDto {
  @ApiProperty({ type: [UpdateBrowseCollectionWithIdDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => UpdateBrowseCollectionWithIdDto)
  collections: UpdateBrowseCollectionWithIdDto[];
}
