import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { DataSource } from 'typeorm';
import { ICartCleanupStrategy } from '../interfaces/cart-cleanup-strategy.interface';

/**
 * Optimized background worker for cart cleanup
 * Only processes carts that have completed or been abandoned (event-driven)
 * Runs every 5 minutes to archive completed/abandoned carts
 */
@Injectable()
export class ReservationWorkerService implements ICartCleanupStrategy {
  private readonly logger = new Logger(ReservationWorkerService.name);

  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    @InjectRepository(BookFormatVariant)
    private readonly variantRepository: Repository<BookFormatVariant>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Process completed and abandoned carts
   * Archive cart data and release reservations
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async processCompletedCarts() {
    this.logger.log('Starting cart cleanup for COMPLETED/ABANDONED carts...');

    try {
      // Find carts with COMPLETED or ABANDONED status
      const cartsToProcess = await this.cartRepository.find({
        where: {
          status: In([CartStatus.COMPLETED, CartStatus.ABANDONED]),
        },
        relations: ['items', 'items.bookFormatVariant'],
        take: 100, // Process in batches
      });

      if (cartsToProcess.length === 0) {
        this.logger.log('No carts to process.');
        return;
      }

      let archivedCount = 0;
      let releasedCount = 0;

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

          // Release reservations for abandoned carts only
          if (cart.status === CartStatus.ABANDONED) {
            for (const item of cart.items) {
              const variant = item.bookFormatVariant;
              if (variant && isPhysicalFormat(variant.format) && item.qty > 0) {
                await queryRunner.manager.update(
                  BookFormatVariant,
                  { id: variant.id },
                  { reservedQuantity: () => `reserved_quantity - ${item.qty}` },
                );
                releasedCount++;
                this.logger.log(`Released ${item.qty} units of variant ${variant.id} from abandoned cart ${cart.id}`);
              }
            }
          }

          // Delete cart items
          await queryRunner.manager.delete(CartItem, { cartId: cart.id });

          // Delete cart
          await queryRunner.manager.delete(Cart, { id: cart.id });

          await queryRunner.commitTransaction();
          archivedCount++;
        } catch (error) {
          await queryRunner.rollbackTransaction();
          this.logger.error(`Error processing cart ${cart.id}`, error);
        } finally {
          await queryRunner.release();
        }
      }

      this.logger.log(`Cart cleanup completed. Archived: ${archivedCount}, Reservations released: ${releasedCount}`);
    } catch (error) {
      this.logger.error('Error during cart cleanup', error);
    }
  }

  /**
   * Manually trigger cleanup for a specific cart (called after payment resolution)
   */
  async cleanupCart(cartId: string): Promise<void> {
    const cart = await this.cartRepository.findOne({
      where: { id: cartId },
      relations: ['items', 'items.bookFormatVariant'],
    });

    if (!cart) {
      this.logger.warn(`Cart ${cartId} not found for cleanup`);
      return;
    }

    if (cart.status !== CartStatus.COMPLETED && cart.status !== CartStatus.ABANDONED) {
      this.logger.warn(`Cart ${cartId} has status ${cart.status}, skipping cleanup`);
      return;
    }

    this.logger.log(`Manually cleaning up cart ${cartId} with status ${cart.status}`);

    // Process this single cart (reuse the logic)
    await this.processCompletedCarts();
  }

  /**
   * Get strategy name for logging/monitoring
   */
  getStrategyName(): string {
    return 'CronBasedCleanup';
  }
}
