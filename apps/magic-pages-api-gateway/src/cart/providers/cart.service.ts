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
import { AuthCartResponseDto } from '@app/contract/carts/dtos/auth-cart-response.dto';
import { GuestCartResponseDto } from '@app/contract/carts/dtos/guest-cart-response.dto';
import { RedisService } from '@app/redis';
import { BookFormat, isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { CartMetricsService } from '../metrics/cart-metrics.service';
import { ShippingRateService } from './shipping-rate.service';
import { TaxService } from './tax.service';

const CART_CACHE_TTL = 3600; // 1 hour
const RESERVATION_TTL = 900; // 15 minutes (authenticated users)
const GUEST_RESERVATION_TTL = 600; // 10 minutes (guest users - shorter to prevent abuse)
const MAX_GUEST_CART_ITEMS = 20; // Limit guest cart items to prevent abuse

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
    private readonly shippingRateService: ShippingRateService,
    private readonly taxService: TaxService,
  ) { }

  /**
   * Get cart for user
   */
  async getCart(userId: number): Promise<AuthCartResponseDto> {
    // Fetch active cart
    let cart = await this.cartRepository
      .createQueryBuilder('cart')
      .leftJoinAndSelect('cart.items', 'items')
      .leftJoinAndSelect('items.bookFormatVariant', 'variant')
      .leftJoinAndSelect('variant.book', 'book')
      .where('cart.userId = :userId', { userId })
      .andWhere('cart.status = :status', { status: CartStatus.ACTIVE })
      .orderBy('items.createdAt', 'ASC')
      .getOne();

    // Create cart if not exists
    if (!cart) {
      cart = this.cartRepository.create({
        userId,
        status: CartStatus.ACTIVE,
      });

      cart = await this.cartRepository.save(cart);
      cart.items = [];
    }

    // Filter invalid items (variant deleted, etc.)
    const validItems = (cart.items || []).filter(
      (item) => item.bookFormatVariant && item.bookFormatVariant.book,
    );

    // Calculate totals
    let subtotal = 0;

    const items = validItems.map((item) => {
      const price = Number(item.unitPrice);
      const qty = Number(item.qty);

      const total = price * qty;
      subtotal += total;

      return {
        id: item.id,
        bookId: item.bookFormatVariant.book.id,
        qty,
        unitPrice: price,
        total,
        title: item.title,
        coverImageUrl: item.coverImageUrl,
        variantId: item.bookFormatVariantId,
        format: item.bookFormatVariant?.format,
      };
    });

    // Flat-rate shipping, computed the SAME way CheckoutService computes it at
    // charge time — both call `ShippingRateService`, so this pre-payment quote
    // and the amount Razorpay actually collects cannot drift apart. Before
    // this, `getCart` had no notion of shipping at all: the storefront summary
    // always showed 0/"Free" for a physical basket, while checkout (correctly)
    // charged the flat rate — a customer-visible quote/charge mismatch the
    // moment `SHIPPING_FLAT_RATE_PAISE` is set above zero.
    const shipping = this.shippingRateService.resolveShippingCost(
      this.shippingRateService.cartHasPhysicalItems(validItems),
    );

    // Tax already inside `subtotal`. Reported so the basket can show the split;
    // deliberately NOT added to `total`, which would double-charge.
    const tax = this.taxService.totalTax(
      validItems.map((item) => ({
        unitPrice: Number(item.unitPrice),
        quantity: Number(item.qty),
        includeTax: item.bookFormatVariant?.includeTax,
        taxPercentage: item.bookFormatVariant?.taxPercentage,
      })),
    );

    return {
      cartId: cart.id,
      userId,
      items,
      subtotal,
      shipping,
      tax,
      total: subtotal + shipping,
      totalItems: items.length,
      totalQuantity: items.reduce((acc, item) => acc + item.qty, 0),
    };
  }

  /**
   * Add item to cart with pessimistic locking for stock reservation
   */
  async addToCart(userId: number, dto: CreateCartItemDto): Promise<AuthCartResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get or create cart
      let cart = await queryRunner.manager.findOne(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
      });

      if (!cart) {
        cart = queryRunner.manager.create(Cart, {
          userId,
          status: CartStatus.ACTIVE,
        });

        cart = await queryRunner.manager.save(cart);
      }

      // Lock variant row
      const variant = await queryRunner.manager
        .createQueryBuilder(BookFormatVariant, 'variant')
        .innerJoinAndSelect('variant.book', 'book')
        .setLock('pessimistic_write')
        .where('variant.id = :id', { id: dto.bookFormatVariantId })
        .getOne();

      if (!variant) {
        throw new NotFoundException(
          `Book variant with ID ${dto.bookFormatVariantId} not found`,
        );
      }

      const isPhysical = isPhysicalFormat(variant.format);

      // Check if item already exists
      const existingItem = await queryRunner.manager.findOne(CartItem, {
        where: {
          cartId: cart.id,
          bookFormatVariantId: dto.bookFormatVariantId,
        },
      });

      const existingQty = existingItem?.qty ?? 0;
      const requestedQty = existingQty + dto.qty;

      if (isPhysical) {
        const availableStock = variant.stockQuantity - variant.reservedQuantity;

        const additionalRequired = requestedQty - existingQty;

        if (availableStock < additionalRequired) {
          throw new ConflictException({
            message: 'Insufficient stock',
            code: 'INSUFFICIENT_STOCK',
            available: availableStock,
            requested: additionalRequired,
          });
        }

        // Reserve only additional quantity
        await queryRunner.manager
          .createQueryBuilder()
          .update(BookFormatVariant)
          .set({
            reservedQuantity: () => `reservedQuantity + :qty`,
          })
          .where('id = :id', { id: variant.id })
          .setParameters({ qty: additionalRequired })
          .execute();
      }

      const book = variant.book;

      if (existingItem) {
        existingItem.qty = requestedQty;
        await queryRunner.manager.save(existingItem);
      } else {
        const cartItem = queryRunner.manager.create(CartItem, {
          cartId: cart.id,
          bookFormatVariantId: dto.bookFormatVariantId,
          qty: dto.qty,
          unitPrice: variant.price,
          title: book?.title ?? 'Unknown',
          coverImageUrl: book?.coverImageUrl ?? '',
        });

        await queryRunner.manager.save(cartItem);
      }

      await queryRunner.commitTransaction();

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
  /**
   * Update cart item quantity
   */
  async updateCartItem(userId: number, itemId: string, dto: UpdateCartItemDto): Promise<AuthCartResponseDto> {
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
      const newQty = dto.qty;
      const qtyDelta = newQty - oldQty;

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

      if (isPhysical) {
        if (!cartItem.isStockReserved) {
          // Case 1: Reservation expired. We need to re-reserve the FULL new quantity.
          const availableStock = variant.stockQuantity - variant.reservedQuantity;

          if (availableStock < newQty) {
            throw new ConflictException({
              message: 'Insufficient stock to re-reserve item',
              code: 'INSUFFICIENT_STOCK',
              available: availableStock,
              requested: newQty,
            });
          }

          // Reserve full amount
          await queryRunner.manager.update(
            BookFormatVariant,
            { id: variant.id },
            { reservedQuantity: () => `reservedQuantity + ${newQty}` },
          );

          // Mark as reserved
          cartItem.isStockReserved = true;

        } else {
          // Case 2: Reservation active. Handle delta.
          if (qtyDelta > 0) {
            // Increasing quantity
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
              { reservedQuantity: () => `reservedQuantity + ${qtyDelta}` },
            );
          } else if (qtyDelta < 0) {
            // Decreasing quantity
            await queryRunner.manager.update(
              BookFormatVariant,
              { id: variant.id },
              { reservedQuantity: () => `reservedQuantity - ${Math.abs(qtyDelta)}` },
            );
          }
        }
      }

      // Update cart item
      cartItem.qty = dto.qty;
      // Ensure we save the isStockReserved change if any
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

      // Release reservation if physical AND reserved
      const variant = cartItem.bookFormatVariant;
      if (!variant) {
        throw new NotFoundException(`Variant not found`);
      }
      const isPhysical = isPhysicalFormat(variant.format);

      if (isPhysical && cartItem.isStockReserved) {
        await queryRunner.manager.update(
          BookFormatVariant,
          { id: variant.id },
          { reservedQuantity: () => `reservedQuantity - ${cartItem.qty}` },
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
        if (isPhysical && item.isStockReserved) {
          await queryRunner.manager.update(
            BookFormatVariant,
            { id: item.bookFormatVariantId },
            { reservedQuantity: () => `reservedQuantity - ${item.qty}` },
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
      bookId: item.bookFormatVariant?.book?.id ?? '',
      bookFormatVariantId: item.bookFormatVariantId,
      title: item.title,
      unitPrice: Number(item.unitPrice),
      qty: item.qty,
      image: item.coverImageUrl || '',
      subtotal: Number(item.unitPrice) * item.qty,
    }));

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);

    // Flat-rate shipping, charged only when the basket contains something
    // shippable. This used to be a hardcoded `0` here and in two other files,
    // so the cart summary could never match what checkout charged.
    const shipping = this.shippingRateService.resolveShippingCost(
      this.shippingRateService.cartHasPhysicalItems(cart.items),
    );

    return {
      id: cart.id,
      items,
      subtotal,
      shipping,
      discount: 0,
      total: subtotal + shipping,
    };
  }

  /**
   * Invalidate cart cache
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

  /**
   * Add item to guest cart with pessimistic locking for stock reservation.
   * Guest carts use sessionId instead of userId.
   * Shorter reservation TTL (10 min) compared to authenticated carts (15 min).
   */
  async addToGuestCart(sessionId: string, dto: CreateCartItemDto): Promise<GuestCartResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get or create guest cart
      let cart = await queryRunner.manager.findOne(Cart, {
        where: { sessionId, status: CartStatus.ACTIVE },
        relations: ['items'],
      });

      if (!cart) {
        cart = queryRunner.manager.create(Cart, {
          sessionId,
          userId: null,
          status: CartStatus.ACTIVE,
        });
        await queryRunner.manager.save(cart);
        cart.items = [];
      }

      // Check guest cart item limit
      if (cart.items.length >= MAX_GUEST_CART_ITEMS) {
        const existingItem = cart.items.find(
          (item) => item.bookFormatVariantId === dto.bookFormatVariantId,
        );
        if (!existingItem) {
          throw new BadRequestException({
            code: 'GUEST_CART_LIMIT',
            message: `Guest carts are limited to ${MAX_GUEST_CART_ITEMS} items. Please sign in for unlimited cart items.`,
          });
        }
      }

      // Lock the variant row with FOR UPDATE (pessimistic locking)
      const variant = await queryRunner.manager
        .createQueryBuilder(BookFormatVariant, 'variant')
        .innerJoinAndSelect('variant.book', 'book')
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
          { reservedQuantity: () => `reservedQuantity + ${dto.qty}` },
        );
      }

      // Get book details from relation
      const book = variant.book;

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

      // Set Redis TTL for reservation tracking (shorter for guests)
      if (isPhysical) {
        const reservationKey = `guest_reservation:${sessionId}:${dto.bookFormatVariantId}`;
        await this.redisService.set(
          reservationKey,
          JSON.stringify({ variantId: dto.bookFormatVariantId, qty: dto.qty }),
          GUEST_RESERVATION_TTL,
        );
      }

      // Invalidate cache
      await this.invalidateGuestCartCache(sessionId);

      // Fetch and return updated cart
      return this.getGuestCart(sessionId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get guest cart by session ID
   */
  async getGuestCart(sessionId: string): Promise<GuestCartResponseDto> {
    // Try cache first
    const cacheKey = `guest_cart:${sessionId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get cart from database
    const cart = await this.cartRepository.findOne({
      where: { sessionId, status: CartStatus.ACTIVE },
      relations: ['items', 'items.bookFormatVariant', 'items.bookFormatVariant.book'],
    });

    if (!cart) {
      // Return empty cart response for new sessions
      const emptyResponse: GuestCartResponseDto = {
        id: '',
        sessionId,
        items: [],
        subtotal: 0,
        itemCount: 0,
        expiresAt: new Date(Date.now() + GUEST_RESERVATION_TTL * 1000).toISOString(),
      };
      return emptyResponse;
    }

    const response = this.buildGuestCartResponse(cart, sessionId);

    // Cache the result (shorter TTL for guest carts)
    await this.redisService.set(cacheKey, JSON.stringify(response), GUEST_RESERVATION_TTL);

    return response;
  }

  /**
   * Build guest cart response DTO
   */
  private buildGuestCartResponse(cart: Cart, sessionId: string): GuestCartResponseDto {
    const items: CartItemResponseDto[] = cart.items.map((item) => ({
      id: item.id,
      bookId: item.bookFormatVariant?.book?.id ?? '',
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
      sessionId,
      items,
      subtotal,
      itemCount: items.length,
      expiresAt: new Date(Date.now() + GUEST_RESERVATION_TTL * 1000).toISOString(),
    };
  }
}
