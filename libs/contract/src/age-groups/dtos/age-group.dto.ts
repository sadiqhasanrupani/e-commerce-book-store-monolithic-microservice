import { ApiProperty } from '@nestjs/swagger';

export class AgeGroupDto {
  @ApiProperty({ example: '3-5' })
  id: string;

  @ApiProperty({ example: 'Ages 3-5' })
  label: string;

  @ApiProperty({ example: 'Picture books and early learning...', required: false })
  description?: string;

  @ApiProperty({ example: 'https://cdn.example.com/hero.jpg', required: false })
  heroImage?: string;

  @ApiProperty({ example: 1 })
  sortOrder: number;
}
