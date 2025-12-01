import { PartialType } from '@nestjs/swagger';
import { CreateAgeGroupDto } from './create-age-group.dto';

export class UpdateAgeGroupDto extends PartialType(CreateAgeGroupDto) { }
