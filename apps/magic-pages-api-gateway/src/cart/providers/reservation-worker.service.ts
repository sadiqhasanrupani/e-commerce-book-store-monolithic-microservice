import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, Not } from 'typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { DataSource } from 'typeorm';
import { RedisService } from '@app/redis';
import { ICartCleanupStrategy } from '../interfaces/cart-cleanup-strategy.interface';

/**
 * Optimized background worker for cart cleanup.
 * Handles both authenticated and guest carts.
 * 
 * - Archives completed/abandoned carts to cart_history
 * - Releases expired reservations (authenticated: 15 min, guest: 10 min)
 * - Cleans up abandoned guest carts (no checkout, inactive > 10 min)
 */
@Injectable()
export class ReservationWorkerService implements ICartCleanupStrategy {
  private readonly logger = new Logger(ReservationWorkerService.name);

  // TTL constants (must match cart.service.ts)
  private readonly AUTHENTICATED_RESERVATION_TTL = 15 * 60 * 1000; // 15 minutes
  private readonly GUEST_RESERVATION_TTL = 10 * 60 * 1000; // 10 minutes

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
   * Main cleanup cron job. Runs every 5 minutes.
   * Processes both authenticated and guest carts.
   * 
   * **Concurrency safety:** Uses row-level locking (FOR UPDATE SKIP LOCKED)
   * to prevent multiple workers from processing the same cart.
   * 
   * **Activity signal:** Relies on cart.updatedAt to determine inactivity.
   * updatedAt is updated on every cart modification (add/update/remove item).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async processCompletedCarts() {
    this.logger.log('Starting cart cleanup (authenticated + guest)...');

    // Authenticated cart cleanup
    await this.archiveCompletedCarts();
    await this.releaseExpiredReservations();

    // Guest cart cleanup
    await this.releaseExpiredGuestReservations();
    await this.cleanupAbandonedGuestCarts();
  }

  /**
   * Archive carts that are COMPLETED or ABANDONED.
   * Uses row-level locking to prevent concurrent processing.
   */
  private async archiveCompletedCarts() {
    try {
      // Use SKIP LOCKED to prevent multiple workers processing same carts
      const cartsToProcess = await this.cartRepository
        .createQueryBuilder('cart')
        .setLock('pessimistic_write_or_fail') // Will skip locked rows
        .leftJoinAndSelect('cart.items', 'items')
        .leftJoinAndSelect('items.bookFormatVariant', 'variant')
        .where('cart.status IN (:...statuses)', {
          statuses: [CartStatus.COMPLETED, CartStatus.ABANDONED],
        })
        .take(100)
        .getMany();

      if (cartsToProcess.length === 0) {
        return;
      }

      this.logger.log(`Archiving ${cartsToProcess.length} completed/abandoned carts...`);

      for (const cart of cartsToProcess) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          // Calculate totals for history
          const totalAmount = cart.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.qty, 0);

          // Archive cart to cart_history
          await queryRunner.manager.query(
            `
            INSERT INTO cart_history (
              id, user_id, status, checkout_started_at, completed_at,
              total_amount, items_count, items_data, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `,
            [
              cart.id,
              cart.userId,
              cart.status,
              cart.checkoutStartedAt,
              new Date(),
              totalAmount,
              cart.items.length,
              JSON.stringify(cart.items),
              cart.createdAt,
              cart.updatedAt,
            ],
          );

          // Release reservations for abandoned carts only (if not already released)
          if (cart.status === CartStatus.ABANDONED) {
            for (const item of cart.items) {
              // Only release if it was reserved
              if (item.isStockReserved) {
                const variant = item.bookFormatVariant;
                if (variant && isPhysicalFormat(variant.format) && item.qty > 0) {
                  await queryRunner.manager.update(
                    BookFormatVariant,
                    { id: variant.id },
                    { reservedQuantity: () => `"reservedQuantity" - ${item.qty}` },
                  );
                  this.logger.log(`Released ${item.qty} units of variant ${variant.id} from abandoned cart ${cart.id}`);
                }
              }
            }
          }

          // Delete cart items
          await queryRunner.manager.delete(CartItem, { cartId: cart.id });

          // Delete cart
          await queryRunner.manager.delete(Cart, { id: cart.id });

          await queryRunner.commitTransaction();
        } catch (error) {
          await queryRunner.rollbackTransaction();
          this.logger.error(`Error processing cart ${cart.id}`, error);
        } finally {
          await queryRunner.release();
        }
      }
    } catch (error) {
      this.logger.error('Error during cart archiving', error);
    }
  }

  /**
   * Release reservations for items in AUTHENTICATED active carts that have expired.
   * TTL: 15 minutes
   */
  private async releaseExpiredReservations() {
    try {
      const expirationTime = new Date(Date.now() - this.AUTHENTICATED_RESERVATION_TTL);

      // Find items that are reserved but belong to carts inactive for > 15 mins
      // We need to join with cart to check updatedAt
      const itemsToRelease = await this.cartItemRepository
        .createQueryBuilder('item')
        .innerJoinAndSelect('item.cart', 'cart')
        .innerJoinAndSelect('item.bookFormatVariant', 'variant')
        .where('item.isStockReserved = :isReserved', { isReserved: true })
        .andWhere('cart.updatedAt < :expirationTime', { expirationTime })
        .andWhere('cart.status = :status', { status: CartStatus.ACTIVE })
        .andWhere('cart.userId IS NOT NULL') // Only authenticated carts
        .take(100)
        .getMany();

      if (itemsToRelease.length === 0) {
        return;
      }

      this.logger.log(`Found ${itemsToRelease.length} expired reservations to release.`);

      for (const item of itemsToRelease) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          const variant = item.bookFormatVariant;
          if (variant && isPhysicalFormat(variant.format) && item.qty > 0) {
            // Decrement reserved quantity
            await queryRunner.manager.update(
              BookFormatVariant,
              { id: variant.id },
              { reservedQuantity: () => `"reservedQuantity" - ${item.qty}` },
            );

            // Mark item as not reserved
            await queryRunner.manager.update(
              CartItem,
              { id: item.id },
              { isStockReserved: false },
            );

            this.logger.log(`Silent release: Released ${item.qty} units of variant ${variant.id} from active cart ${item.cartId}`);
          } else {
            // If not physical or invalid, just mark as unreserved to stop picking it up
            await queryRunner.manager.update(
              CartItem,
              { id: item.id },
              { isStockReserved: false },
            );
          }

          await queryRunner.commitTransaction();
        } catch (error) {
          await queryRunner.rollbackTransaction();
          this.logger.error(`Error releasing reservation for item ${item.id}`, error);
        } finally {
          await queryRunner.release();
        }
      }
    } catch (error) {
      this.logger.error('Error during expired reservation release', error);
    }
  }

  /**
   * Manually trigger cleanup for a specific cart (called after payment resolution).
   * Processes ONLY the specified cart, not all carts.
   */
  async cleanupCart(cartId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Lock the specific cart for processing
      const cart = await queryRunner.manager
        .createQueryBuilder(Cart, 'cart')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('cart.items', 'items')
        .leftJoinAndSelect('items.bookFormatVariant', 'variant')
        .where('cart.id = :cartId', { cartId })
        .getOne();

      if (!cart) {
        this.logger.warn(`Cart ${cartId} not found for cleanup`);
        await queryRunner.rollbackTransaction();
        return;
      }

      if (cart.status !== CartStatus.COMPLETED && cart.status !== CartStatus.ABANDONED) {
        this.logger.warn(`Cart ${cartId} has status ${cart.status}, skipping cleanup`);
        await queryRunner.rollbackTransaction();
        return;
      }

      this.logger.log(`Manually cleaning up cart ${cartId} with status ${cart.status}`);

      // Calculate totals for history
      const totalAmount = cart.items.reduce(
        (sum, item) => sum + Number(item.unitPrice) * item.qty,
        0,
      );

      // Archive to cart_history
      await queryRunner.manager.query(
        `INSERT INTO cart_history (
          id, user_id, status, checkout_started_at, completed_at,
          total_amount, items_count, items_data, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          cart.id,
          cart.userId,
          cart.status,
          cart.checkoutStartedAt,
          new Date(),
          totalAmount,
          cart.items.length,
          JSON.stringify(cart.items),
          cart.createdAt,
          cart.updatedAt,
        ],
      );

      // Release reservations for abandoned carts
      if (cart.status === CartStatus.ABANDONED) {
        for (const item of cart.items) {
          if (item.isStockReserved) {
            const variant = item.bookFormatVariant;
            if (variant && isPhysicalFormat(variant.format) && item.qty > 0) {
              await queryRunner.manager.update(
                BookFormatVariant,
                { id: variant.id },
                { reservedQuantity: () => `GREATEST(0, "reservedQuantity" - ${item.qty})` },
              );
              this.logger.log(
                `Released ${item.qty} units of variant ${variant.id} from abandoned cart ${cart.id}`,
              );
            }
          }
        }
      }

      // Delete cart items and cart
      await queryRunner.manager.delete(CartItem, { cartId: cart.id });
      await queryRunner.manager.delete(Cart, { id: cart.id });

      await queryRunner.commitTransaction();
      this.logger.log(`Successfully cleaned up cart ${cartId}`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error cleaning up cart ${cartId}`, error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get strategy name for logging/monitoring
   */
  getStrategyName(): string {
    return 'CronBasedCleanup';
  }

  /**
   * Release reservations for items in GUEST active carts that have expired.
   * TTL: 10 minutes (shorter than authenticated to prevent abuse)
   */
  private async releaseExpiredGuestReservations() {
    try {
      const expirationTime = new Date(Date.now() - this.GUEST_RESERVATION_TTL);

      // Find items in guest carts that are expired
      const itemsToRelease = await this.cartItemRepository
        .createQueryBuilder('item')
        .innerJoinAndSelect('item.cart', 'cart')
        .innerJoinAndSelect('item.bookFormatVariant', 'variant')
        .where('item.isStockReserved = :isReserved', { isReserved: true })
        .andWhere('cart.updatedAt < :expirationTime', { expirationTime })
        .andWhere('cart.status = :status', { status: CartStatus.ACTIVE })
        .andWhere('cart.sessionId IS NOT NULL') // Only guest carts
        .take(100)
        .getMany();

      if (itemsToRelease.length === 0) {
        return;
      }

      this.logger.log(`Found ${itemsToRelease.length} expired GUEST reservations to release.`);

      for (const item of itemsToRelease) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          const variant = item.bookFormatVariant;
          const cart = item.cart;

          if (variant && isPhysicalFormat(variant.format) && item.qty > 0) {
            // Decrement reserved quantity
            await queryRunner.manager.update(
              BookFormatVariant,
              { id: variant.id },
              { reservedQuantity: () => `GREATEST(0, "reservedQuantity" - ${item.qty})` },
            );

            // Mark item as not reserved
            await queryRunner.manager.update(
              CartItem,
              { id: item.id },
              { isStockReserved: false },
            );

            // Delete Redis reservation key (non-blocking - log error but don't fail DB cleanup)
            if (cart.sessionId) {
              try {
                const reservationKey = `guest_reservation:${cart.sessionId}:${item.bookFormatVariantId}`;
                await this.redisService.del(reservationKey);
              } catch (redisError) {
                this.logger.warn(`Failed to delete Redis key for variant ${item.bookFormatVariantId}: ${redisError}`);
              }
            }

            this.logger.log(`Released ${item.qty} units of variant ${variant.id} from guest cart ${item.cartId}`);
          } else {
            // Just mark as unreserved
            await queryRunner.manager.update(
              CartItem,
              { id: item.id },
              { isStockReserved: false },
            );
          }

          await queryRunner.commitTransaction();
        } catch (error) {
          await queryRunner.rollbackTransaction();
          this.logger.error(`Error releasing guest reservation for item ${item.id}`, error);
        } finally {
          await queryRunner.release();
        }
      }
    } catch (error) {
      this.logger.error('Error during guest reservation release', error);
    }
  }

  /**
   * Cleanup abandoned guest carts.
   * Guest carts inactive for > 10 minutes are deleted.
   * (Unlike authenticated carts, guest carts are not archived to cart_history)
   */
  private async cleanupAbandonedGuestCarts() {
    try {
      const expirationTime = new Date(Date.now() - this.GUEST_RESERVATION_TTL);

      // Find abandoned guest carts
      const guestCarts = await this.cartRepository.find({
        where: {
          sessionId: Not(IsNull()),
          status: CartStatus.ACTIVE,
        },
        relations: ['items', 'items.bookFormatVariant'],
        take: 50,
      });

      // Filter to only expired carts
      const expiredCarts = guestCarts.filter(
        (cart) => cart.updatedAt < expirationTime,
      );

      if (expiredCarts.length === 0) {
        return;
      }

      this.logger.log(`Cleaning up ${expiredCarts.length} abandoned guest carts...`);

      for (const cart of expiredCarts) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          // Release any remaining reservations
          for (const item of cart.items) {
            if (
              item.isStockReserved &&
              item.bookFormatVariant &&
              isPhysicalFormat(item.bookFormatVariant.format) &&
              item.qty > 0
            ) {
              await queryRunner.manager.update(
                BookFormatVariant,
                { id: item.bookFormatVariantId },
                { reservedQuantity: () => `GREATEST(0, "reservedQuantity" - ${item.qty})` },
              );
            }

            // Delete Redis reservation key (non-blocking - log error but don't fail DB cleanup)
            if (cart.sessionId) {
              try {
                const reservationKey = `guest_reservation:${cart.sessionId}:${item.bookFormatVariantId}`;
                await this.redisService.del(reservationKey);
              } catch (redisError) {
                this.logger.warn(`Failed to delete Redis key for variant ${item.bookFormatVariantId}: ${redisError}`);
              }
            }
          }

          // Delete cart items and cart (no archiving for guest carts)
          await queryRunner.manager.delete(CartItem, { cartId: cart.id });
          await queryRunner.manager.delete(Cart, { id: cart.id });

          await queryRunner.commitTransaction();
          this.logger.log(`Deleted abandoned guest cart ${cart.id} (session: ${cart.sessionId})`);
        } catch (error) {
          await queryRunner.rollbackTransaction();
          this.logger.error(`Error cleaning up guest cart ${cart.id}`, error);
        } finally {
          await queryRunner.release();
        }
      }
    } catch (error) {
      this.logger.error('Error during guest cart cleanup', error);
    }
  }
}
