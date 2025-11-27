import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CartService } from './providers/cart.service';
import { CreateCartItemDto } from '@app/contract/carts/dtos/create-cart-item.dto';
import { UpdateCartItemDto } from '@app/contract/carts/dtos/update-cart-item.dto';
import { CartResponseDto } from '@app/contract/carts/dtos/cart-response.dto';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';

@ApiTags('Cart')
@ApiBearerAuth()
@Controller('cart')
@Auth(AuthTypes.BEARER)
export class CartController {
  constructor(private readonly cartService: CartService) { }

  @Get()
  @ApiOperation({ summary: 'Get current user cart' })
  @ApiResponse({ status: 200, description: 'Cart retrieved successfully', type: CartResponseDto })
  async getCart(@Request() req): Promise<CartResponseDto> {
    return this.cartService.getCart(req.user.id);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiResponse({ status: 201, description: 'Item added to cart' })
  @ApiResponse({ status: 409, description: 'Insufficient stock' })
  async addItem(@Request() req, @Body() dto: CreateCartItemDto): Promise<CartResponseDto> {
    return this.cartService.addToCart(req.user.id, dto);
  }

  @Put('items/:itemId')
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiResponse({ status: 200, description: 'Item updated successfully' })
  @ApiResponse({ status: 409, description: 'Insufficient stock' })
  async updateItem(
    @Request() req,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    return this.cartService.updateCartItem(req.user.id, itemId, dto);
  }

  @Delete('items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove item from cart' })
  @ApiResponse({ status: 204, description: 'Item removed successfully' })
  async removeItem(@Request() req, @Param('itemId') itemId: string): Promise<void> {
    await this.cartService.removeFromCart(req.user.id, itemId);
  }

  @Post('clear')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear all items from cart' })
  @ApiResponse({ status: 204, description: 'Cart cleared successfully' })
  async clearCart(@Request() req): Promise<void> {
    await this.cartService.clearCart(req.user.id);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Checkout cart and create order' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  @ApiResponse({ status: 409, description: 'Insufficient stock or invalid cart' })
  async checkout(@Request() req): Promise<{ orderId: string; message: string }> {
    // Stub for Sprint 1 - full implementation in Sprint 2
    return {
      orderId: 'stub-order-id',
      message: 'Checkout endpoint - to be implemented in Sprint 2',
    };
  }
}
