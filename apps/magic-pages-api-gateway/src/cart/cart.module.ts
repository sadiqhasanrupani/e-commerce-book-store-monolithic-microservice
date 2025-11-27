import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { CartController } from './cart.controller';
import { PaymentWebhookController } from './payment-webhook.controller';
import { CartService } from './providers/cart.service';
import { ReservationWorkerService } from './providers/reservation-worker.service';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Book } from '@app/contract/books/entities/book.entity';
import { RedisModule } from '@app/redis';
import { ConfigService } from '@nestjs/config';
import { ICartCleanupStrategy } from './interfaces/cart-cleanup-strategy.interface';
import { TracingInterceptor } from './interceptors/tracing.interceptor';
import { CheckoutService } from './providers/checkout.service';
import { PhonePeProvider } from './providers/phonepe.provider';
import { GooglePayProvider } from './providers/googlepay.provider';
import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';
import Redis from 'ioredis';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, CartItem, BookFormatVariant, Book, Order, OrderItem, OrderStatusLog]),
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
  controllers: [CartController, PaymentWebhookController],
  providers: [
    CartService,
    CheckoutService,
    ReservationWorkerService,
    TracingInterceptor,
    PhonePeProvider,
    GooglePayProvider,
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
    // Strategy pattern for payment
    {
      provide: 'PAYMENT_PROVIDER',
      useFactory: (
        configService: ConfigService,
        phonePe: PhonePeProvider,
        googlePay: GooglePayProvider,
      ) => {
        const provider = configService.get<string>('PAYMENT_PROVIDER', 'phonepe');
        if (provider === 'googlepay') return googlePay;
        return phonePe;
      },
      inject: [ConfigService, PhonePeProvider, GooglePayProvider],
    },
  ],
  exports: [CartService, CheckoutService],
})
export class CartModule { }
