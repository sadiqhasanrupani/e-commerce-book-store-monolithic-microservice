import { PartialType } from '@nestjs/swagger';
import { CreateBrowseCollectionDto } from './create-browse-collection.dto';

export class UpdateBrowseCollectionDto extends PartialType(CreateBrowseCollectionDto) { }
