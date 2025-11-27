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

@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, CartItem, BookFormatVariant, Book]),
    RedisModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [CartController],
  providers: [CartService, ReservationWorkerService],
  exports: [CartService],
})
export class CartModule { }
