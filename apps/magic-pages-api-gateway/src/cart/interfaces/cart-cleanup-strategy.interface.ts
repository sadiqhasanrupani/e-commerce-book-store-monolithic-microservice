/**
 * Abstract interface for cart cleanup strategies
 * Allows switching between cron-based and event-driven (RabbitMQ) cleanup
 */
export interface ICartCleanupStrategy {
    /**
     * Process completed and abandoned carts
     * Implementation can be cron-based or event-driven
     */
    processCompletedCarts(): Promise<void>;

    /**
     * Manually trigger cleanup for a specific cart
     * Called after payment resolution
     */
    cleanupCart(cartId: string): Promise<void>;

    /**
     * Get strategy name for logging/monitoring
     */
    getStrategyName(): string;
}
