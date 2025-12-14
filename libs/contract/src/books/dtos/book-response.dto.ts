import { ApiProperty } from '@nestjs/swagger';
import { BookVariantResponseDto } from './book-variant-response.dto';

export class BookResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true })
  subtitle?: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ nullable: true })
  authorName?: string;

  @ApiProperty({ nullable: true })
  publisher?: string;

  @ApiProperty()
  publishedDate: Date;

  @ApiProperty()
  description: string;

  @ApiProperty({ nullable: true })
  shortDescription?: string;

  @ApiProperty({ nullable: true })
  longDescription?: string;

  @ApiProperty({ nullable: true })
  coverImageUrl?: string;

  @ApiProperty({ type: [String], nullable: true })
  snapshotUrls?: string[];

  @ApiProperty({ type: [String], nullable: true })
  snapshots?: string[];

  @ApiProperty({ example: 4.5 })
  rating: number;

  @ApiProperty({ nullable: true })
  genre?: string;

  @ApiProperty()
  isBestseller: boolean;

  @ApiProperty()
  isFeatured: boolean;

  @ApiProperty()
  isNewRelease: boolean;

  @ApiProperty({ type: [BookVariantResponseDto] })
  variants: BookVariantResponseDto[];

  @ApiProperty({ required: false, enum: ['public', 'private', 'draft'] })
  visibility?: 'public' | 'private' | 'draft';

  @ApiProperty({ required: false })
  isArchived?: boolean;

  @ApiProperty({ required: false, type: [String] })
  bullets?: string[];

  @ApiProperty({ required: false, type: [String] })
  ageGroupIds?: string[];

  @ApiProperty({ required: false, type: [String] })
  categoryIds?: string[];

  @ApiProperty({ required: false, type: [String] })
  tagIds?: string[];
}
