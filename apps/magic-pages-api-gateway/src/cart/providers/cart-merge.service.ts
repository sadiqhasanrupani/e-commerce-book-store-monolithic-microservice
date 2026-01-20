import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { RedisService } from '@app/redis';
import {
  MergeCartRequestDto,
  MergeCartResponseDto,
  MergeConflictDto,
  MergeCartItemDto,
} from '@app/contract/carts/dtos/merge-cart.dto';
import { CartResponseDto, CartItemResponseDto } from '@app/contract/carts/dtos/cart-response.dto';

const RESERVATION_TTL = 900; // 15 minutes for authenticated users

/**
 * Service for merging guest carts into authenticated user carts.
 * Called after login to sync local cart with backend.
 */
@Injectable()
export class CartMergeService {
  private readonly logger = new Logger(CartMergeService.name);

  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    @InjectRepository(BookFormatVariant)
    private readonly variantRepository: Repository<BookFormatVariant>,
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) { }

  /**
   * Merge guest cart items into authenticated user's cart.
   * 
   * **Idempotency:**
   * - If called twice with same sessionId, second call is a no-op (guest cart already deleted)
   * - Frontend sends items array as source of truth from IndexedDB
   * 
   * **Conflict handling:**
   * - `unavailable`: variant no longer exists → item NOT added
   * - `out_of_stock`: insufficient stock → item NOT added
   * - `price_changed`: price differs from local snapshot → item IS added with new price, conflict reported
   * 
   * **Operation order (critical for stock consistency):**
   * 1. Get/create authenticated user cart
   * 2. For each merge item:
   *    a. Lock variant row (pessimistic write)
   *    b. Check availability and stock
   *    c. Acquire reservation in user cart (increment reservedQuantity)
   * 3. Find guest cart by sessionId (if exists):
   *    a. Release guest reservations (decrement reservedQuantity)
   *    b. Delete Redis guest reservation keys
   *    c. Delete guest cart items
   *    d. Delete guest cart
   * 4. Commit transaction
   * 5. Invalidate caches
   */
  async mergeCart(userId: number, dto: MergeCartRequestDto): Promise<MergeCartResponseDto> {
    this.logger.log(`Merging cart for user ${userId} from session ${dto.sessionId}`);

    // Early return if no items to merge
    if (!dto.items || dto.items.length === 0) {
      const userCart = await this.getOrCreateUserCart(userId);
      return {
        cart: await this.buildCartResponse(userCart),
        merged: { itemCount: 0, totalAdded: 0 },
        conflicts: [],
      };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const conflicts: MergeConflictDto[] = [];
    let itemCount = 0;
    let totalAdded = 0;

    try {
      // 1. Get or create user's authenticated cart
      let userCart = await queryRunner.manager.findOne(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
        relations: ['items'],
      });

      if (!userCart) {
        userCart = queryRunner.manager.create(Cart, {
          userId,
          sessionId: null,
          status: CartStatus.ACTIVE,
        });
        await queryRunner.manager.save(userCart);
        userCart.items = [];
      }

      // 2. Process each item from the merge request
      for (const item of dto.items) {
        const result = await this.processItemMerge(
          queryRunner,
          userCart,
          item,
          userId,
        );

        if (result.conflict) {
          conflicts.push(result.conflict);
        }
        if (result.added) {
          itemCount++;
          totalAdded += item.qty;
        }
      }

      // 3. Release guest reservations and delete guest cart
      // Order: Release reservations → Delete Redis keys → Delete cart items → Delete cart
      const guestCart = await queryRunner.manager.findOne(Cart, {
        where: { sessionId: dto.sessionId, status: CartStatus.ACTIVE },
        relations: ['items', 'items.bookFormatVariant'],
      });

      if (guestCart) {
        this.logger.log(`Found guest cart ${guestCart.id} with ${guestCart.items.length} items`);

        // Step 3a: Release guest reservations (decrement reservedQuantity)
        for (const item of guestCart.items) {
          if (item.bookFormatVariant && isPhysicalFormat(item.bookFormatVariant.format)) {
            if (item.isStockReserved) {
              await queryRunner.manager.update(
                BookFormatVariant,
                { id: item.bookFormatVariantId },
                { reservedQuantity: () => `GREATEST(0, reservedQuantity - ${item.qty})` },
              );
              this.logger.debug(`Released ${item.qty} reservation for variant ${item.bookFormatVariantId}`);
            }
          }
        }

        // Step 3b: Delete Redis guest reservation keys
        for (const item of guestCart.items) {
          if (item.bookFormatVariant && isPhysicalFormat(item.bookFormatVariant.format)) {
            const reservationKey = `guest_reservation:${dto.sessionId}:${item.bookFormatVariantId}`;
            await this.redisService.del(reservationKey);
          }
        }

        // Step 3c & 3d: Delete guest cart items and cart
        await queryRunner.manager.remove(guestCart.items);
        await queryRunner.manager.remove(guestCart);
        this.logger.log(`Deleted guest cart ${guestCart.id} for session ${dto.sessionId}`);
      }

      await queryRunner.commitTransaction();

      // Invalidate caches
      await this.invalidateCartCache(userId);
      await this.invalidateGuestCartCache(dto.sessionId);

      // Fetch updated cart
      const updatedCart = await this.cartRepository.findOne({
        where: { userId, status: CartStatus.ACTIVE },
        relations: ['items', 'items.bookFormatVariant', 'items.bookFormatVariant.book'],
      });

      return {
        cart: await this.buildCartResponse(updatedCart!),
        merged: { itemCount, totalAdded },
        conflicts,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Cart merge failed for user ${userId}`, error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Process a single item merge with conflict detection.
   * 
   * Conflicts:
   * - unavailable: variant not found → NOT added
   * - out_of_stock: insufficient stock → NOT added
   * - price_changed: price differs → IS added with new price, conflict reported
   */
  private async processItemMerge(
    queryRunner: any,
    userCart: Cart,
    item: MergeCartItemDto,
    userId: number,
  ): Promise<{ added: boolean; conflict?: MergeConflictDto }> {
    // Lock and fetch the variant
    const variant = await queryRunner.manager
      .createQueryBuilder(BookFormatVariant, 'variant')
      .innerJoinAndSelect('variant.book', 'book')
      .setLock('pessimistic_write')
      .where('variant.id = :id', { id: item.bookFormatVariantId })
      .getOne();

    // Conflict: Variant not found
    if (!variant) {
      return {
        added: false,
        conflict: {
          bookFormatVariantId: item.bookFormatVariantId,
          reason: 'unavailable',
          message: 'This product is no longer available',
        },
      };
    }

    // Detect price changes (compare with local snapshot if provided)
    // If frontend sends localPriceCents, compare with current backend price
    // Item IS still added with new price; conflict is informational
    let priceChangeConflict: MergeConflictDto | undefined;

    // variant.price is in cents (integer) in the database
    const currentPriceCents = Math.round(Number(variant.price) * 100);

    if (item.localPriceCents !== undefined && item.localPriceCents !== currentPriceCents) {
      priceChangeConflict = {
        bookFormatVariantId: item.bookFormatVariantId,
        reason: 'price_changed',
        message: `Price has changed from ${(item.localPriceCents / 100).toFixed(2)} to ${(currentPriceCents / 100).toFixed(2)}`,
        details: {
          oldPrice: item.localPriceCents,
          newPrice: currentPriceCents,
        },
      };
      this.logger.log(`Price change detected for variant ${item.bookFormatVariantId}: ${item.localPriceCents} -> ${currentPriceCents}`);
    }

    const isPhysical = isPhysicalFormat(variant.format);

    // Conflict: Insufficient stock for physical items
    if (isPhysical) {
      const availableStock = variant.stockQuantity - variant.reservedQuantity;
      if (availableStock < item.qty) {
        return {
          added: false,
          conflict: {
            bookFormatVariantId: item.bookFormatVariantId,
            reason: 'out_of_stock',
            message: `Only ${availableStock} items available`,
            details: {
              requested: item.qty,
              available: availableStock,
            },
          },
        };
      }
    }

    // Check if item already exists in user's cart
    const existingItem = await queryRunner.manager.findOne(CartItem, {
      where: { cartId: userCart.id, bookFormatVariantId: item.bookFormatVariantId },
    });

    if (existingItem) {
      // Merge quantities
      const newQty = existingItem.qty + item.qty;

      // Check stock for merged quantity
      if (isPhysical) {
        const availableStock = variant.stockQuantity - variant.reservedQuantity + existingItem.qty;
        if (availableStock < newQty) {
          return {
            added: false,
            conflict: {
              bookFormatVariantId: item.bookFormatVariantId,
              reason: 'out_of_stock',
              message: `Cannot add ${item.qty} more. Only ${availableStock - existingItem.qty} additional available`,
              details: {
                requested: item.qty,
                available: availableStock - existingItem.qty,
              },
            },
          };
        }

        // Reserve additional stock
        await queryRunner.manager.update(
          BookFormatVariant,
          { id: variant.id },
          { reservedQuantity: () => `reservedQuantity + ${item.qty}` },
        );
      }

      existingItem.qty = newQty;
      await queryRunner.manager.save(existingItem);
    } else {
      // Create new cart item
      if (isPhysical) {
        // Reserve stock (acquire reservation in user cart)
        await queryRunner.manager.update(
          BookFormatVariant,
          { id: variant.id },
          { reservedQuantity: () => `reservedQuantity + ${item.qty}` },
        );
      }

      const newItem = queryRunner.manager.create(CartItem, {
        cartId: userCart.id,
        bookFormatVariantId: item.bookFormatVariantId,
        qty: item.qty,
        unitPrice: variant.price, // Always use current backend price
        title: variant.book?.title || 'Unknown',
        coverImageUrl: variant.book?.coverImageUrl || '',
        isStockReserved: isPhysical,
      });
      await queryRunner.manager.save(newItem);
    }

    // Set Redis TTL for reservation tracking
    if (isPhysical) {
      const reservationKey = `cart_reservation:${userCart.id}:${item.bookFormatVariantId}`;
      await this.redisService.set(
        reservationKey,
        JSON.stringify({ variantId: item.bookFormatVariantId, qty: item.qty }),
        RESERVATION_TTL,
      );
    }

    // Return success with any price change conflict
    return { added: true, conflict: priceChangeConflict };
  }

  /**
   * Get or create authenticated user's cart
   */
  private async getOrCreateUserCart(userId: number): Promise<Cart> {
    let cart = await this.cartRepository.findOne({
      where: { userId, status: CartStatus.ACTIVE },
      relations: ['items', 'items.bookFormatVariant', 'items.bookFormatVariant.book'],
    });

    if (!cart) {
      cart = this.cartRepository.create({
        userId,
        sessionId: null,
        status: CartStatus.ACTIVE,
        items: [],
      });
      await this.cartRepository.save(cart);
    }

    return cart;
  }

  /**
   * Build cart response DTO
   */
  private async buildCartResponse(cart: Cart): Promise<CartResponseDto> {
    const items: CartItemResponseDto[] = (cart.items || []).map((item) => ({
      id: item.id,
      bookFormatVariantId: item.bookFormatVariantId,
      title: item.title,
      unitPrice: Number(item.unitPrice),
      qty: item.qty,
      image: item.coverImageUrl || '',
      subtotal: Number(item.unitPrice) * item.qty,
    }));

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);

    return {
      id: cart.id,
      items,
      subtotal,
      shipping: 0,
      discount: 0,
      total: subtotal,
    };
  }

  /**
   * Invalidate authenticated cart cache
   */
  private async invalidateCartCache(userId: number): Promise<void> {
    const cacheKey = `cart:${userId}`;
    await this.redisService.del(cacheKey);
  }

  /**
   * Invalidate guest cart cache
   */
  private async invalidateGuestCartCache(sessionId: string): Promise<void> {
    const cacheKey = `guest_cart:${sessionId}`;
    await this.redisService.del(cacheKey);
  }
}
