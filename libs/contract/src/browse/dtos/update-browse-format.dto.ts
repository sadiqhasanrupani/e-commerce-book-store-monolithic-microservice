import { PartialType } from '@nestjs/swagger';
import { CreateBrowseFormatDto } from './create-browse-format.dto';

export class UpdateBrowseFormatDto extends PartialType(CreateBrowseFormatDto) { }
