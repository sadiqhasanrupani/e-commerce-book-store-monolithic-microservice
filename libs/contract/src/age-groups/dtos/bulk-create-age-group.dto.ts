import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { CreateAgeGroupDto } from './create-age-group.dto';

export class BulkCreateAgeGroupDto {
  @ApiProperty({ type: [CreateAgeGroupDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => CreateAgeGroupDto)
  ageGroups: CreateAgeGroupDto[];
}
