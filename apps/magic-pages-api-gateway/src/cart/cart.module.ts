import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { CartController } from './cart.controller';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, CartItem, BookFormatVariant, Book]),
    RedisModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [CartController],
  providers: [
    CartService,
    ReservationWorkerService,
    TracingInterceptor,
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
  ],
  exports: [CartService],
})
export class CartModule { }
