import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, ArrayMinSize, IsString, IsNotEmpty } from 'class-validator';
import { UpdateAgeGroupDto } from './update-age-group.dto';

export class UpdateAgeGroupWithIdDto extends UpdateAgeGroupDto {
  @ApiProperty({ example: '3-5', description: 'ID of the age group' })
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class BulkUpdateAgeGroupDto {
  @ApiProperty({ type: [UpdateAgeGroupWithIdDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => UpdateAgeGroupWithIdDto)
  ageGroups: UpdateAgeGroupWithIdDto[];
}
