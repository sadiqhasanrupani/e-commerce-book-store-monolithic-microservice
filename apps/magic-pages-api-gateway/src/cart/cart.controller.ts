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
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { CartService } from './providers/cart.service';
import { CartMergeService } from './providers/cart-merge.service';
import { CreateCartItemDto } from '@app/contract/carts/dtos/create-cart-item.dto';
import { UpdateCartItemDto } from '@app/contract/carts/dtos/update-cart-item.dto';
import { CartResponseDto } from '@app/contract/carts/dtos/cart-response.dto';
import { CheckoutDto } from '@app/contract/carts/dtos/checkout.dto';
import { MergeCartRequestDto, MergeCartResponseDto } from '@app/contract/carts/dtos/merge-cart.dto';
import { CheckoutService } from './providers/checkout.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { TracingInterceptor } from './interceptors/tracing.interceptor';

@ApiTags('Cart')
@ApiBearerAuth()
@Controller('cart')
@Auth(AuthTypes.BEARER)
@UseInterceptors(TracingInterceptor)
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly checkoutService: CheckoutService,
    private readonly cartMergeService: CartMergeService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Get current user cart' })
  @ApiResponse({ status: 200, description: 'Cart retrieved successfully', type: CartResponseDto })
  async getCart(@Request() req): Promise<CartResponseDto> {
    return this.cartService.getCart(req.user.userId);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiResponse({ status: 201, description: 'Item added to cart' })
  @ApiResponse({ status: 409, description: 'Insufficient stock' })
  async addItem(@Request() req, @Body() dto: CreateCartItemDto): Promise<CartResponseDto> {
    return this.cartService.addToCart(req.user.userId, dto);
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
    return this.cartService.updateCartItem(req.user.userId, itemId, dto);
  }

  @Delete('items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove item from cart' })
  @ApiResponse({ status: 204, description: 'Item removed successfully' })
  async removeItem(@Request() req, @Param('itemId') itemId: string): Promise<void> {
    await this.cartService.removeFromCart(req.user.userId, itemId);
  }

  @Post('clear')
  @ApiOperation({ summary: 'Clear cart' })
  @ApiResponse({ status: 204, description: 'Cart cleared successfully' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearCart(@Request() req) {
    return this.cartService.clearCart(req.user.userId);
  }

  @Post('merge')
  @ApiOperation({ summary: 'Merge guest cart into authenticated user cart' })
  @ApiResponse({ status: 200, description: 'Cart merged successfully', type: MergeCartResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async mergeCart(
    @Request() req,
    @Body() dto: MergeCartRequestDto,
  ): Promise<MergeCartResponseDto> {
    return this.cartMergeService.mergeCart(req.user.userId, dto);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Checkout cart' })
  @ApiResponse({ status: 201, description: 'Checkout initiated' })
  async checkout(@Request() req, @Body() dto: CheckoutDto) {
    // TODO: Extract idempotency key from headers
    const idempotencyKey = req.headers['idempotency-key'];
    return this.checkoutService.checkout(req.user.userId, dto, idempotencyKey);
  }
}

