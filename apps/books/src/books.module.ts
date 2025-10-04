import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';

import { BooksController } from './books.controller';
import { BooksService } from './books.service';

import { GlobalConfigModule } from '@app/global-config';
import { DatabaseModule } from '@app/database';

import { User } from './entities/users.entity';

@Module({
  imports: [
    GlobalConfigModule,
    DatabaseModule,
    TypeOrmModule.forFeature([User]),
  ],
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule { }
