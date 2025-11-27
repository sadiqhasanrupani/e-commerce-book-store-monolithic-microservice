import { IsInt, Min, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCartItemDto {
    @ApiProperty({ example: 1, description: 'ID of the book format variant' })
    @IsInt()
    @IsNotEmpty()
    bookFormatVariantId: number;

    @ApiProperty({ example: 1, description: 'Quantity to add', minimum: 1 })
    @IsInt()
    @Min(1)
    qty: number;
}
