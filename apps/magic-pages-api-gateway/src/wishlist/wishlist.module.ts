import { Module } from '@nestjs/common';

import { WishlistController } from './wishlist.controller';
import { WishlistService } from './providers/wishlist.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wishlist } from '@app/contract/wishlist/entities/wishlist.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Wishlist])],
  providers: [WishlistService],
  controllers: [WishlistController],
  exports: [TypeOrmModule]
})
export class WishlistModule { }
