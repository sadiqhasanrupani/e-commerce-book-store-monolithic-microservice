import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';

/**
 * Background worker to release expired cart reservations
 * Runs every 5 minutes to check for abandoned carts
 */
@Injectable()
export class ReservationWorkerService {
  private readonly logger = new Logger(ReservationWorkerService.name);
  private readonly RESERVATION_TIMEOUT_MINUTES = 15;

  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    @InjectRepository(BookFormatVariant)
    private readonly variantRepository: Repository<BookFormatVariant>,
  ) { }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseExpiredReservations() {
    this.logger.log('Starting expired reservation cleanup...');

    try {
      const cutoffTime = new Date();
      cutoffTime.setMinutes(cutoffTime.getMinutes() - this.RESERVATION_TIMEOUT_MINUTES);

      // Find carts that haven't been updated in the last 15 minutes
      const expiredCarts = await this.cartRepository.find({
        where: {
          status: 'ACTIVE',
          updatedAt: LessThan(cutoffTime),
        },
        relations: ['items', 'items.bookFormatVariant'],
      });

      let releasedCount = 0;

      for (const cart of expiredCarts) {
        for (const item of cart.items) {
          const variant = item.bookFormatVariant;
          const isPhysical = isPhysicalFormat(variant.format);

          if (isPhysical && item.qty > 0) {
            // Release reservation
            await this.variantRepository.update(
              { id: variant.id },
              { reservedQuantity: () => `reserved_quantity - ${item.qty}` },
            );
            releasedCount++;
            this.logger.log(
              `Released ${item.qty} units of variant ${variant.id} from expired cart ${cart.id}`,
            );
          }
        }

        // Optionally, clear the cart or mark it as expired
        // For now, we just release reservations but keep the cart
      }

      this.logger.log(`Expired reservation cleanup completed. Released ${releasedCount} items.`);
    } catch (error) {
      this.logger.error('Error during expired reservation cleanup', error);
    }
  }
}
