# Event-Driven Architecture Evaluation: RabbitMQ vs Current Approach

## Question
Should we use RabbitMQ for event-driven cart cleanup instead of the current cron-based approach?

## Current Approach (Implemented)

**How it works:**
- Cron job runs every 5 minutes
- Queries carts with status `COMPLETED` or `ABANDONED`
- Processes in batches of 100
- Archives to `cart_history` and releases reservations

**Pros:**
- ✅ Simple to implement and maintain
- ✅ No additional infrastructure needed (RabbitMQ already exists but not required)
- ✅ Easy to monitor and debug
- ✅ Predictable resource usage
- ✅ Works well for current scale

**Cons:**
- ❌ 5-minute delay before cleanup (not critical)
- ❌ Processes carts even if none need cleanup

## RabbitMQ Approach (Alternative)

**How it would work:**
1. When cart status changes to `COMPLETED`/`ABANDONED`, publish event to RabbitMQ
2. Worker consumes events and processes immediately
3. No polling needed

**Pros:**
- ✅ Immediate cleanup (no 5-minute delay)
- ✅ True event-driven architecture
- ✅ More scalable for high volume
- ✅ Better resource utilization (only processes when needed)

**Cons:**
- ❌ More complex (event publishing, queue management, dead letter queues)
- ❌ Additional failure points (queue down, message loss)
- ❌ Requires RabbitMQ monitoring and management
- ❌ Overkill for current scale

## Recommendation: **Stick with Current Cron Approach**

### Reasoning:

1. **Current Scale**: For an e-commerce bookstore, carts don't complete/abandon at such high frequency that we need immediate processing. 5-minute delay is acceptable.

2. **Simplicity**: The cron approach is much simpler to maintain and debug. No need to manage message queues, handle retries, or deal with queue failures.

3. **Resource Efficiency**: Current approach already optimized (90%+ reduction from Sprint 1). Only queries carts that need processing.

4. **Infrastructure**: While RabbitMQ exists in the project, adding it for this use case adds complexity without significant benefit.

5. **Monitoring**: Cron jobs are easier to monitor - just check logs every 5 minutes. RabbitMQ requires queue depth monitoring, consumer health checks, etc.

### When to Consider RabbitMQ:

Switch to RabbitMQ if:
- Cart completion rate exceeds 1000/minute
- 5-minute cleanup delay becomes a business problem
- Need to trigger other async actions on cart completion (emails, analytics, etc.)
- Already using RabbitMQ heavily for other workflows

### Hybrid Approach (Future Enhancement):

If needed, we can use RabbitMQ for **critical** events while keeping cron for cleanup:

```typescript
// On checkout completion
await this.eventEmitter.emit('cart.completed', { cartId, userId });

// RabbitMQ consumer for immediate actions
@RabbitSubscribe({
  exchange: 'cart.events',
  routingKey: 'cart.completed'
})
async handleCartCompleted(data: { cartId: string; userId: number }) {
  // Send confirmation email immediately
  await this.emailService.sendOrderConfirmation(data.userId);
  
  // Trigger analytics
  await this.analyticsService.trackPurchase(data.cartId);
  
  // Cleanup can still happen via cron (not time-sensitive)
}
```

## Decision: Keep Current Cron Approach ✅

The current implementation is optimal for the use case. We can always migrate to RabbitMQ later if scale demands it.
