import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { CartService } from './providers/cart.service';
import { CreateCartItemDto } from '@app/contract/carts/dtos/create-cart-item.dto';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { SessionIdGuard, REQUEST_SESSION_KEY } from './guards/session-id.guard';
import { TracingInterceptor } from './interceptors/tracing.interceptor';
import { GuestCartResponseDto } from '@app/contract/carts/dtos/guest-cart-response.dto';

/**
 * Controller for guest cart operations.
 * 
 * These endpoints do NOT require authentication.
 * Guest carts are identified by a session ID passed in the X-Session-Id header.
 */
@ApiTags('Guest Cart')
@Controller('cart/guest')
@Auth(AuthTypes.NONE)
@UseInterceptors(TracingInterceptor)
export class GuestCartController {
  constructor(private readonly cartService: CartService) { }

  @Post('items')
  @UseGuards(SessionIdGuard)
  @ApiOperation({ summary: 'Add item to guest cart' })
  @ApiHeader({
    name: 'X-Session-Id',
    description: 'Frontend-generated UUID v4 for guest session',
    required: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 201, description: 'Item added to guest cart', type: GuestCartResponseDto })
  @ApiResponse({ status: 400, description: 'Missing or invalid session ID' })
  @ApiResponse({ status: 404, description: 'Book variant not found' })
  @ApiResponse({ status: 409, description: 'Insufficient stock' })
  async addItem(
    @Request() req,
    @Body() dto: CreateCartItemDto,
  ): Promise<GuestCartResponseDto> {
    const sessionId: string = req[REQUEST_SESSION_KEY];
    return this.cartService.addToGuestCart(sessionId, dto);
  }
}
