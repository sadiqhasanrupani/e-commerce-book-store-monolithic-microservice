import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Cart } from '../../../../../libs/contract/src/carts/entities/cart.entity';
import { Repository, LessThan } from 'typeorm';
import { CartStatus } from '../../../../../libs/contract/src/carts/enums/cart-status.enum';
import { BookFormatVariant } from '../../../../../libs/contract/src/books/entities/book-format-varient.entity';
import { CartItem } from '../../../../../libs/contract/src/carts/entities/cart-item.entity';

@Injectable()
export class ReservationCleanupService {
  private readonly logger = new Logger(ReservationCleanupService.name);

  constructor(
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(BookFormatVariant)
    private readonly variantRepo: Repository<BookFormatVariant>,
    @InjectRepository(CartItem)
    private readonly cartItemRepo: Repository<CartItem>,
  ) { }

  @Cron(CronExpression.EVERY_MINUTE) // Run every minute
  async cleanupStaleReservations() {
    this.logger.log('Running stale reservation cleanup...');

    // 1. Find ACTIVE carts updated more than 15 minutes ago
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    const staleCarts = await this.cartRepo.find({
      where: {
        status: CartStatus.ACTIVE,
        updatedAt: LessThan(fifteenMinutesAgo),
      },
      relations: ['items'],
    });

    if (staleCarts.length === 0) {
      return;
    }

    this.logger.log(`Found ${staleCarts.length} stale ACTIVE carts.`);

    for (const cart of staleCarts) {
      // 2. Release reserved stock for each item
      for (const item of cart.items) {
        if (item.isStockReserved && item.bookFormatVariantId) {
          // Decrement reserved quantity
          await this.variantRepo.decrement(
            { id: item.bookFormatVariantId },
            'reservedQuantity',
            item.qty
          );

          // Mark item as not reserved
          item.isStockReserved = false;
          await this.cartItemRepo.save(item);
        }
      }

      // 3. We don't necessarily delete the cart, but we could mark it as ABANDONED
      // or just leave it ACTIVE but with no reservation?
      // Requirement said "clean up stale active cart reservations".
      // Assuming we just release stock and maybe touch the cart so it doesn't get picked up again immediately?
      // Or if we released stock, we should set `is_stock_reserved` to false on items so we don't double release.
      // Modifying items requires CartItemRepository or cascade.

      // Simpler approach for now: Just decrement reserved stock. 
      // But if we run this again next minute, we will decrement again! 
      // CRITICAL: We MUST mark items as unreserved or change cart status.
      // Let's change cart status to ABANDONED.

      cart.status = CartStatus.ABANDONED;
      await this.cartRepo.save(cart);

      this.logger.log(`Cart ${cart.id} marked as ABANDONED and stock released.`);
    }
  }
}
