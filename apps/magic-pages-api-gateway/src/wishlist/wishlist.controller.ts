import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { WishlistService } from './providers/wishlist.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { CurrentUser } from 'libs/common/src/decorators/current-user.decorator';
import { UserData } from 'libs/common/src/types/user-data.type';

// DTOs
import { AddToWishlistDto } from '@app/contract/wishlist/dtos/add-to-wishlist.dto';
import { UpdateWishlistDto } from '@app/contract/wishlist/dtos/update-wishlist.dto';
import { WishlistQueryDto } from '@app/contract/wishlist/dtos/wishlist-query.dto';
import {
  WishlistPaginatedResponseDto,
  WishlistItemResponseDto,
  WishlistCheckResponseDto,
} from '@app/contract/wishlist/dtos/wishlist-response.dto';

@ApiTags('Wishlist')
@ApiBearerAuth()
@Controller('user/wishlist')
@Auth(AuthTypes.BEARER)
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) { }

  /**
   * Get paginated wishlist for the authenticated user
   */
  @Get()
  @ApiOperation({ summary: 'Get user wishlist with pagination' })
  @ApiResponse({
    status: 200,
    description: 'Wishlist retrieved successfully',
    type: WishlistPaginatedResponseDto,
  })
  async getWishlist(
    @CurrentUser() user: UserData,
    @Query() query: WishlistQueryDto,
  ): Promise<WishlistPaginatedResponseDto> {
    return this.wishlistService.findByUser(user.userId, query);
  }

  /**
   * Add a book to the wishlist (idempotent)
   */
  @Post()
  @ApiOperation({ summary: 'Add book to wishlist' })
  @ApiResponse({
    status: 201,
    description: 'Book added to wishlist',
    type: WishlistItemResponseDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Book already in wishlist (idempotent)',
    type: WishlistItemResponseDto,
  })
  async addToWishlist(
    @CurrentUser() user: UserData,
    @Body() dto: AddToWishlistDto,
  ): Promise<WishlistItemResponseDto> {
    return this.wishlistService.add(user.userId, dto);
  }

  /**
   * Remove an item from the wishlist
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove item from wishlist' })
  @ApiResponse({ status: 204, description: 'Item removed successfully' })
  @ApiResponse({ status: 404, description: 'Wishlist item not found' })
  @ApiResponse({ status: 403, description: 'Item does not belong to user' })
  async removeFromWishlist(
    @CurrentUser() user: UserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.wishlistService.remove(user.userId, id);
  }

  /**
   * Update a wishlist item (e.g., notifyOnSale flag)
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update wishlist item' })
  @ApiResponse({
    status: 200,
    description: 'Item updated successfully',
    type: WishlistItemResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Wishlist item not found' })
  @ApiResponse({ status: 403, description: 'Item does not belong to user' })
  async updateWishlistItem(
    @CurrentUser() user: UserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWishlistDto,
  ): Promise<WishlistItemResponseDto> {
    return this.wishlistService.update(user.userId, id, dto);
  }

  /**
   * Check if a book is in the user's wishlist
   */
  @Get('check/:bookId')
  @ApiOperation({ summary: 'Check if book is in wishlist' })
  @ApiResponse({
    status: 200,
    description: 'Check completed',
    type: WishlistCheckResponseDto,
  })
  async checkInWishlist(
    @CurrentUser() user: UserData,
    @Param('bookId', ParseUUIDPipe) bookId: string,
  ): Promise<WishlistCheckResponseDto> {
    return this.wishlistService.isInWishlist(user.userId, bookId);
  }
}
