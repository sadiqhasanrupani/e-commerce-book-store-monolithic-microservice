import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class RemoveBookFromAgeGroupDto {
  @ApiProperty({
    description: 'The UUID of the book',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsNotEmpty()
  @IsUUID()
  bookId: string;

  @ApiProperty({
    description: 'The ID of the age group',
    example: '3-5',
  })
  @IsNotEmpty()
  @IsString()
  ageGroupId: string;
}
