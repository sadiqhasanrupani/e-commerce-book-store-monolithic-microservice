import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Book } from '@app/contract/books/entities/book.entity';
import { CreateCartItemDto } from '@app/contract/carts/dtos/create-cart-item.dto';
import { UpdateCartItemDto } from '@app/contract/carts/dtos/update-cart-item.dto';
import { CartResponseDto, CartItemResponseDto } from '@app/contract/carts/dtos/cart-response.dto';
import { RedisService } from '@app/redis';
import { BookFormat, isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { CartMetricsService } from '../metrics/cart-metrics.service';

const CART_CACHE_TTL = 3600; // 1 hour
const RESERVATION_TTL = 900; // 15 minutes

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    @InjectRepository(BookFormatVariant)
    private readonly variantRepository: Repository<BookFormatVariant>,
    @InjectRepository(Book)
    private readonly bookRepository: Repository<Book>,
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly metricsService: CartMetricsService,
  ) { }

  /**
   * Get cart for user - with Redis caching
   */
  async getCart(userId: number): Promise<CartResponseDto> {
    // Try cache first
    const cacheKey = `cart:${userId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get or create cart
    let cart = await this.cartRepository.findOne({
      where: { userId, status: CartStatus.ACTIVE },
      relations: ['items', 'items.bookFormatVariant', 'items.bookFormatVariant.book'],
    });

    if (!cart) {
      cart = this.cartRepository.create({ userId, status: CartStatus.ACTIVE, items: [] });
      await this.cartRepository.save(cart);
    }

    const response = await this.buildCartResponse(cart);

    // Cache the result
    await this.redisService.set(cacheKey, JSON.stringify(response), CART_CACHE_TTL);

    return response;
  }

  /**
   * Add item to cart with pessimistic locking for stock reservation
   */
  async addToCart(userId: number, dto: CreateCartItemDto): Promise<CartResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get or create cart
      let cart = await queryRunner.manager.findOne(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
      });

      if (!cart) {
        cart = queryRunner.manager.create(Cart, { userId, status: CartStatus.ACTIVE });
        await queryRunner.manager.save(cart);
      }

      // Lock the variant row with FOR UPDATE (pessimistic locking)
      const variant = await queryRunner.manager
        .createQueryBuilder(BookFormatVariant, 'variant')
        .setLock('pessimistic_write')
        .where('variant.id = :id', { id: dto.bookFormatVariantId })
        .getOne();

      if (!variant) {
        throw new NotFoundException(`Book variant with ID ${dto.bookFormatVariantId} not found`);
      }

      // Check if variant is physical and needs stock reservation
      const isPhysical = isPhysicalFormat(variant.format);

      if (isPhysical) {
        const availableStock = variant.stockQuantity - variant.reservedQuantity;
        if (availableStock < dto.qty) {
          throw new ConflictException({
            message: 'Insufficient stock',
            code: 'INSUFFICIENT_STOCK',
            available: availableStock,
            requested: dto.qty,
          });
        }

        // Reserve stock
        await queryRunner.manager.update(
          BookFormatVariant,
          { id: variant.id },
          { reservedQuantity: () => `reserved_quantity + ${dto.qty}` },
        );
      }

      // Get book details for snapshot
      const book = await queryRunner.manager.findOne(Book, {
        where: { id: variant.bookId },
      });

      // Check if item already exists in cart
      const existingItem = await queryRunner.manager.findOne(CartItem, {
        where: { cartId: cart.id, bookFormatVariantId: dto.bookFormatVariantId },
      });

      if (existingItem) {
        // Update quantity
        existingItem.qty += dto.qty;
        await queryRunner.manager.save(existingItem);
      } else {
        // Create new cart item
        const cartItem = queryRunner.manager.create(CartItem, {
          cartId: cart.id,
          bookFormatVariantId: dto.bookFormatVariantId,
          qty: dto.qty,
          unitPrice: variant.price,
          title: book?.title || 'Unknown',
          coverImageUrl: book?.coverImageUrl || '',
        });
        await queryRunner.manager.save(cartItem);
      }

      await queryRunner.commitTransaction();

      // Set Redis TTL for reservation tracking
      if (isPhysical) {
        const reservationKey = `cart_reservation:${cart.id}:${dto.bookFormatVariantId}`;
        await this.redisService.set(
          reservationKey,
          JSON.stringify({ variantId: dto.bookFormatVariantId, qty: dto.qty }),
          RESERVATION_TTL,
        );
      }

      // Invalidate cache
      await this.invalidateCartCache(userId);

      return this.getCart(userId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Update cart item quantity
   */
  async updateCartItem(userId: number, itemId: string, dto: UpdateCartItemDto): Promise<CartResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find cart item
      const cartItem = await queryRunner.manager.findOne(CartItem, {
        where: { id: itemId },
        relations: ['cart', 'bookFormatVariant'],
      });

      if (!cartItem) {
        throw new NotFoundException(`Cart item with ID ${itemId} not found`);
      }

      // Verify ownership
      if (cartItem.cart.userId !== userId) {
        throw new ForbiddenException('You do not have access to this cart item');
      }

      const oldQty = cartItem.qty;
      const qtyDelta = dto.qty - oldQty;

      // Lock variant row
      const variant = await queryRunner.manager
        .createQueryBuilder(BookFormatVariant, 'variant')
        .setLock('pessimistic_write')
        .where('variant.id = :id', { id: cartItem.bookFormatVariantId })
        .getOne();

      if (!variant) {
        throw new NotFoundException(`Variant not found`);
      }

      const isPhysical = isPhysicalFormat(variant.format);

      if (isPhysical && qtyDelta > 0) {
        // Increasing quantity - need to reserve more
        const availableStock = variant.stockQuantity - variant.reservedQuantity;
        if (availableStock < qtyDelta) {
          throw new ConflictException({
            message: 'Insufficient stock',
            code: 'INSUFFICIENT_STOCK',
            available: availableStock,
            requested: qtyDelta,
          });
        }

        await queryRunner.manager.update(
          BookFormatVariant,
          { id: variant.id },
          { reservedQuantity: () => `reserved_quantity + ${qtyDelta}` },
        );
      } else if (isPhysical && qtyDelta < 0) {
        // Decreasing quantity - release reservation
        await queryRunner.manager.update(
          BookFormatVariant,
          { id: variant.id },
          { reservedQuantity: () => `reserved_quantity - ${Math.abs(qtyDelta)}` },
        );
      }

      // Update cart item
      cartItem.qty = dto.qty;
      await queryRunner.manager.save(cartItem);

      await queryRunner.commitTransaction();

      // Update Redis reservation TTL
      if (isPhysical) {
        const reservationKey = `cart_reservation:${cartItem.cartId}:${cartItem.bookFormatVariantId}`;
        await this.redisService.set(
          reservationKey,
          JSON.stringify({ variantId: cartItem.bookFormatVariantId, qty: dto.qty }),
          RESERVATION_TTL,
        );
      }

      await this.invalidateCartCache(userId);

      return this.getCart(userId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Remove item from cart and release reservation
   */
  async removeFromCart(userId: number, itemId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const cartItem = await queryRunner.manager.findOne(CartItem, {
        where: { id: itemId },
        relations: ['cart', 'bookFormatVariant'],
      });

      if (!cartItem) {
        throw new NotFoundException(`Cart item with ID ${itemId} not found`);
      }

      if (cartItem.cart.userId !== userId) {
        throw new ForbiddenException('You do not have access to this cart item');
      }

      // Release reservation if physical
      const variant = cartItem.bookFormatVariant;
      if (!variant) {
        throw new NotFoundException(`Variant not found`);
      }
      const isPhysical = isPhysicalFormat(variant.format);

      if (isPhysical) {
        await queryRunner.manager.update(
          BookFormatVariant,
          { id: variant.id },
          { reservedQuantity: () => `reserved_quantity - ${cartItem.qty}` },
        );

        // Remove Redis reservation
        const reservationKey = `cart_reservation:${cartItem.cartId}:${cartItem.bookFormatVariantId}`;
        await this.redisService.del(reservationKey);
      }

      await queryRunner.manager.remove(cartItem);

      await queryRunner.commitTransaction();

      await this.invalidateCartCache(userId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Clear all items from cart
   */
  async clearCart(userId: number): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const cart = await queryRunner.manager.findOne(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
        relations: ['items', 'items.bookFormatVariant'],
      });

      if (!cart) {
        return;
      }

      // Release all reservations
      for (const item of cart.items) {
        const isPhysical = isPhysicalFormat(item.bookFormatVariant.format);
        if (isPhysical) {
          await queryRunner.manager.update(
            BookFormatVariant,
            { id: item.bookFormatVariantId },
            { reservedQuantity: () => `reserved_quantity - ${item.qty}` },
          );

          const reservationKey = `cart_reservation:${cart.id}:${item.bookFormatVariantId}`;
          await this.redisService.del(reservationKey);
        }
      }

      await queryRunner.manager.remove(cart.items);

      await queryRunner.commitTransaction();

      await this.invalidateCartCache(userId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Build cart response DTO
   */
  private async buildCartResponse(cart: Cart): Promise<CartResponseDto> {
    const items: CartItemResponseDto[] = cart.items.map((item) => ({
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
   * Invalidate cart cache
   */
  private async invalidateCartCache(userId: number): Promise<void> {
    const cacheKey = `cart:${userId}`;
    await this.redisService.del(cacheKey);
  }
}
