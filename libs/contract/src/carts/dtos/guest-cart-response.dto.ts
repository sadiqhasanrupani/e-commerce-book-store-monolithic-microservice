import { ApiProperty } from '@nestjs/swagger';
import { CartItemResponseDto } from './cart-response.dto';

/**
 * Response DTO for guest cart operations.
 * Extends the standard cart response with guest-specific fields.
 */
export class GuestCartResponseDto {
  @ApiProperty({ description: 'Cart UUID' })
  id: string;

  @ApiProperty({ description: 'Session ID (echoed back for confirmation)' })
  sessionId: string;

  @ApiProperty({ type: [CartItemResponseDto], description: 'Cart items' })
  items: CartItemResponseDto[];

  @ApiProperty({ description: 'Cart subtotal' })
  subtotal: number;

  @ApiProperty({ description: 'Number of items in cart' })
  itemCount: number;

  @ApiProperty({ description: 'ISO timestamp when guest cart expires' })
  expiresAt: string;
}
