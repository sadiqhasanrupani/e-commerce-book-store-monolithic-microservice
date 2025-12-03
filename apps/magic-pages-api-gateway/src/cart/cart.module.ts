import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { CartController } from './cart.controller';
import { PaymentWebhookController } from './payment-webhook.controller';
import { TransactionsController } from './transactions.controller';
import { CartService } from './providers/cart.service';
import { ReservationWorkerService } from './providers/reservation-worker.service';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Book } from '@app/contract/books/entities/book.entity';
import { RedisModule } from '@app/redis';
import { ConfigService } from '@nestjs/config';
import { TracingInterceptor } from './interceptors/tracing.interceptor';
import { CheckoutService } from './providers/checkout.service';
import { PhonePeProvider } from './providers/phonepe.provider';
import { RazorpayProvider } from './providers/razorpay.provider';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';
import { Transaction } from '@app/contract/orders/entities/transaction.entity';
import { Refund } from '@app/contract/orders/entities/refund.entity';
import Redis from 'ioredis';
import { makeCounterProvider, makeGaugeProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
import { CartMetricsService } from './metrics/cart-metrics.service';
import { PaymentReconciliationService } from './services/payment-reconciliation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, CartItem, BookFormatVariant, Book, Order, OrderItem, OrderStatusLog, Transaction, Refund]),
    RedisModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'checkout',
            ttl: 60000, // 1 minute
            limit: 10, // 10 requests per minute per user
          },
          {
            name: 'global',
            ttl: 60000,
            limit: 100, // 100 requests per minute globally
          },
        ],
        storage: new ThrottlerStorageRedisService(
          new Redis({
            host: configService.get('REDIS_HOST', 'localhost'),
            port: configService.get('REDIS_PORT', 6379),
          }),
        ),
      }),
    }),
  ],
  controllers: [CartController, PaymentWebhookController, TransactionsController],
  providers: [
    CartService,
    CheckoutService,
    ReservationWorkerService,
    TracingInterceptor,
    PhonePeProvider,
    RazorpayProvider,
    PaymentReconciliationService,
    // Strategy pattern for cleanup
    {
      provide: 'CART_CLEANUP_STRATEGY',
      useFactory: (configService: ConfigService, cronStrategy: ReservationWorkerService) => {
        const strategy = configService.get<string>('CART_CLEANUP_STRATEGY', 'cron');

        if (strategy === 'rabbitmq') {
          // Return RabbitMQ strategy when implemented
          // return new RabbitMQCleanupStrategy(...);
          throw new Error('RabbitMQ strategy not yet implemented. Use cron strategy.');
        }

        return cronStrategy; // Default to cron
      },
      inject: [ConfigService, ReservationWorkerService],
    },
    // Metrics
    // Metrics
    CartMetricsService,
    makeCounterProvider({
      name: 'cart_operations_total',
      help: 'Total number of cart operations',
      labelNames: ['operation', 'status'],
    }),
    makeGaugeProvider({
      name: 'cart_items_count',
      help: 'Current number of items in carts',
    }),
    makeCounterProvider({
      name: 'checkout_requests_total',
      help: 'Total number of checkout requests',
      labelNames: ['status'],
    }),
    makeHistogramProvider({
      name: 'checkout_duration_seconds',
      help: 'Duration of checkout requests in seconds',
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    }),
    makeCounterProvider({
      name: 'payment_webhook_total',
      help: 'Total number of payment webhook events',
      labelNames: ['status', 'provider'],
    }),
    makeCounterProvider({
      name: 'stock_reservation_total',
      help: 'Total number of stock reservation operations',
      labelNames: ['status'],
    }),
    makeCounterProvider({
      name: 'cache_operations_total',
      help: 'Total number of cache operations',
      labelNames: ['operation'],
    }),
  ],
  exports: [CartService, CheckoutService, CartMetricsService],
})
export class CartModule { }
