# Cart Cleanup Strategy Pattern

## Overview

The cart cleanup system uses the **Strategy Pattern** to allow easy switching between different cleanup implementations without changing the core logic.

## Current Strategies

### 1. CronBasedCleanup (Default)
- **Implementation**: `ReservationWorkerService`
- **How it works**: Runs every 5 minutes via `@Cron` decorator
- **Use case**: Default for most deployments
- **Pros**: Simple, reliable, no extra infrastructure
- **Cons**: 5-minute delay before cleanup

### 2. RabbitMQEventDriven (Future)
- **Implementation**: `RabbitMQCleanupStrategy`
- **How it works**: Listens to cart events via RabbitMQ
- **Use case**: High-volume deployments
- **Pros**: Immediate cleanup, scalable
- **Cons**: More complex, requires RabbitMQ

## Switching Strategies

### Via Environment Variable

Add to `.env.development` or `.env.production`:

```bash
# Use cron-based cleanup (default)
CART_CLEANUP_STRATEGY=cron

# Use RabbitMQ-based cleanup (when implemented)
CART_CLEANUP_STRATEGY=rabbitmq
```

### How It Works

The `CartModule` uses a factory provider:

```typescript
{
  provide: 'CART_CLEANUP_STRATEGY',
  useFactory: (configService: ConfigService, cronStrategy: ReservationWorkerService) => {
    const strategy = configService.get<string>('CART_CLEANUP_STRATEGY', 'cron');
    
    if (strategy === 'rabbitmq') {
      return new RabbitMQCleanupStrategy(...);
    }
    
    return cronStrategy; // Default
  },
  inject: [ConfigService, ReservationWorkerService],
}
```

## Interface

All strategies implement `ICartCleanupStrategy`:

```typescript
interface ICartCleanupStrategy {
  processCompletedCarts(): Promise<void>;
  cleanupCart(cartId: string): Promise<void>;
  getStrategyName(): string;
}
```

## Adding a New Strategy

1. **Create strategy class**:
```typescript
@Injectable()
export class MyCustomStrategy implements ICartCleanupStrategy {
  async processCompletedCarts(): Promise<void> {
    // Your implementation
  }
  
  async cleanupCart(cartId: string): Promise<void> {
    // Your implementation
  }
  
  getStrategyName(): string {
    return 'MyCustomStrategy';
  }
}
```

2. **Register in CartModule**:
```typescript
{
  provide: 'CART_CLEANUP_STRATEGY',
  useFactory: (config, cronStrategy, customStrategy) => {
    const strategy = config.get('CART_CLEANUP_STRATEGY');
    
    switch (strategy) {
      case 'custom': return customStrategy;
      case 'rabbitmq': return rabbitmqStrategy;
      default: return cronStrategy;
    }
  },
  inject: [ConfigService, ReservationWorkerService, MyCustomStrategy],
}
```

3. **Set environment variable**:
```bash
CART_CLEANUP_STRATEGY=custom
```

## Benefits

1. **Easy Migration**: Switch strategies without code changes
2. **Testing**: Use different strategies for dev/staging/prod
3. **Flexibility**: Add new strategies without modifying existing code
4. **Monitoring**: Each strategy reports its name for observability

## Future: RabbitMQ Implementation

When implementing RabbitMQ strategy:

1. Install dependencies:
```bash
npm install @nestjs/microservices amqplib
```

2. Publish events on cart status change:
```typescript
// In checkout service
await this.rabbitMQ.publish('cart.completed', { cartId, userId });
```

3. Consume events in RabbitMQCleanupStrategy:
```typescript
@RabbitSubscribe({
  exchange: 'cart.events',
  routingKey: 'cart.completed'
})
async handleCartCompleted(data: { cartId: string }) {
  await this.cleanupCart(data.cartId);
}
```

## Monitoring

Log strategy name on startup:

```typescript
const strategy = this.moduleRef.get('CART_CLEANUP_STRATEGY');
this.logger.log(`Using cleanup strategy: ${strategy.getStrategyName()}`);
```
