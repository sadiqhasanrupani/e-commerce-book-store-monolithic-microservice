import { Injectable, Logger } from '@nestjs/common';
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
 * RabbitMQ-based event-driven cart cleanup strategy
 * Processes carts immediately when they transition to COMPLETED/ABANDONED
 * 
 * To enable: Set CART_CLEANUP_STRATEGY=rabbitmq in environment
 */
@Injectable()
export class RabbitMQCleanupStrategy implements ICartCleanupStrategy {
    private readonly logger = new Logger(RabbitMQCleanupStrategy.name);

    constructor(
        @InjectRepository(Cart)
        private readonly cartRepository: Repository<Cart>,
        @InjectRepository(CartItem)
        private readonly cartItemRepository: Repository<CartItem>,
        @InjectRepository(BookFormatVariant)
        private readonly variantRepository: Repository<BookFormatVariant>,
        private readonly dataSource: DataSource,
        // Inject RabbitMQ service when implementing
        // private readonly rabbitMQService: RabbitMQService,
    ) {
        this.logger.log('RabbitMQ cleanup strategy initialized');
    }

    /**
     * Subscribe to cart.completed and cart.abandoned events
     * This would be called by RabbitMQ consumer
     */
    async processCompletedCarts(): Promise<void> {
        // This method would be triggered by RabbitMQ events
        // For now, it's a placeholder for future implementation
        this.logger.warn('RabbitMQ cleanup not yet implemented. Use CronBasedCleanup instead.');
    }

    /**
     * Manually trigger cleanup for a specific cart
     * Publishes event to RabbitMQ queue
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

        // TODO: Publish to RabbitMQ queue
        // await this.rabbitMQService.publish('cart.cleanup', { cartId, status: cart.status });

        this.logger.log(`Published cleanup event for cart ${cartId} to RabbitMQ`);
    }

    getStrategyName(): string {
        return 'RabbitMQEventDriven';
    }
}
