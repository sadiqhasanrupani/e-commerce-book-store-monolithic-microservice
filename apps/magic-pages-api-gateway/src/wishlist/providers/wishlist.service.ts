import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Wishlist } from '@app/contract/wishlist/entities/wishlist.entity';
import { AddToWishlistDto } from '@app/contract/wishlist/dtos/add-to-wishlist.dto';
import { UpdateWishlistDto } from '@app/contract/wishlist/dtos/update-wishlist.dto';
import {
  WishlistQueryDto,
  WishlistSortBy,
  SortOrder,
} from '@app/contract/wishlist/dtos/wishlist-query.dto';
import {
  WishlistPaginatedResponseDto,
  WishlistItemResponseDto,
  WishlistCheckResponseDto,
} from '@app/contract/wishlist/dtos/wishlist-response.dto';
import { WishlistAddedFrom } from '@app/contract/wishlist/enums/wishlist-added-from.enum';

@Injectable()
export class WishlistService {
  private readonly logger = new Logger(WishlistService.name);

  constructor(
    @InjectRepository(Wishlist)
    private readonly wishlistRepo: Repository<Wishlist>,
  ) { }

  /**
   * Get paginated wishlist for a user
   */
  async findByUser(
    userId: number,
    query: WishlistQueryDto,
  ): Promise<WishlistPaginatedResponseDto> {
    const {
      page = 1,
      limit = 20,
      sortBy = WishlistSortBy.CREATED_AT,
      order = SortOrder.DESC,
    } = query;

    const skip = (page - 1) * limit;

    // Build sort options based on sortBy
    let orderBy: Record<string, 'ASC' | 'DESC'>;
    switch (sortBy) {
      case WishlistSortBy.BOOK_TITLE:
        orderBy = { 'book.title': order };
        break;
      case WishlistSortBy.PRICE:
        // Price sorting would require joining variants - fallback to createdAt for now
        orderBy = { createdAt: order };
        break;
      case WishlistSortBy.CREATED_AT:
      default:
        orderBy = { createdAt: order };
    }

    const [items, total] = await this.wishlistRepo.findAndCount({
      where: { userId },
      relations: ['book'],
      order: orderBy,
      skip,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    return {
      items: items.map((item) => this.mapToItemResponse(item)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Add a book to the wishlist (idempotent)
   */
  async add(userId: number, dto: AddToWishlistDto): Promise<WishlistItemResponseDto> {
    // Check if already exists (idempotent)
    const existing = await this.wishlistRepo.findOne({
      where: { userId, bookId: dto.bookId },
      relations: ['book'],
    });

    if (existing) {
      this.logger.debug(
        `Book ${dto.bookId} already in wishlist for user ${userId}, returning existing`,
      );
      return this.mapToItemResponse(existing);
    }

    // Create new wishlist item
    const wishlistItem = this.wishlistRepo.create({
      userId,
      bookId: dto.bookId,
      addedFrom: dto.addedFrom || WishlistAddedFrom.PDP,
    });

    const saved = await this.wishlistRepo.save(wishlistItem);

    // Reload with relations
    const withRelations = await this.wishlistRepo.findOne({
      where: { id: saved.id },
      relations: ['book'],
    });

    this.logger.log(`Book ${dto.bookId} added to wishlist for user ${userId}`);

    return this.mapToItemResponse(withRelations!);
  }

  /**
   * Remove an item from the wishlist
   */
  async remove(userId: number, itemId: string): Promise<void> {
    const item = await this.wishlistRepo.findOne({
      where: { id: itemId },
      select: ['id', 'userId'],
    });

    if (!item) {
      throw new NotFoundException(`Wishlist item ${itemId} not found`);
    }

    // Security check: ensure user owns this item
    if (item.userId !== userId) {
      this.logger.warn(
        `User ${userId} attempted to delete wishlist item ${itemId} belonging to user ${item.userId}`,
      );
      throw new ForbiddenException('You cannot remove items from another user\'s wishlist');
    }

    await this.wishlistRepo.delete({ id: itemId });
    this.logger.log(`Wishlist item ${itemId} removed for user ${userId}`);
  }

  /**
   * Update a wishlist item (e.g., notifyOnSale flag)
   */
  async update(
    userId: number,
    itemId: string,
    dto: UpdateWishlistDto,
  ): Promise<WishlistItemResponseDto> {
    const item = await this.wishlistRepo.findOne({
      where: { id: itemId },
      relations: ['book'],
    });

    if (!item) {
      throw new NotFoundException(`Wishlist item ${itemId} not found`);
    }

    // Security check: ensure user owns this item
    if (item.userId !== userId) {
      this.logger.warn(
        `User ${userId} attempted to update wishlist item ${itemId} belonging to user ${item.userId}`,
      );
      throw new ForbiddenException('You cannot update items in another user\'s wishlist');
    }

    // Update fields
    if (dto.notifyOnSale !== undefined) {
      item.notifyOnSale = dto.notifyOnSale;
    }

    const updated = await this.wishlistRepo.save(item);
    this.logger.log(`Wishlist item ${itemId} updated for user ${userId}`);

    return this.mapToItemResponse(updated);
  }

  /**
   * Check if a book is in the user's wishlist
   */
  async isInWishlist(userId: number, bookId: string): Promise<WishlistCheckResponseDto> {
    const item = await this.wishlistRepo.findOne({
      where: { userId, bookId },
      select: ['id'],
    });

    return {
      inWishlist: !!item,
      id: item?.id,
    };
  }

  /**
   * Map entity to response DTO
   */
  private mapToItemResponse(item: Wishlist): WishlistItemResponseDto {
    return {
      id: item.id,
      bookId: item.bookId,
      book: {
        id: item.book?.id || item.bookId,
        title: item.book?.title || '',
        authorName: item.book?.authorName || '',
        coverImageUrl: item.book?.coverImageUrl || '',
        slug: item.book?.slug,
      },
      addedFrom: item.addedFrom,
      notifyOnSale: item.notifyOnSale,
      createdAt: item.createdAt,
    };
  }
}
