import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWishlistDto {
  @ApiPropertyOptional({
    description: 'Enable price drop notifications for this item',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnSale?: boolean;
}
