import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '@app/contract/books/entities/categories.entity';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './providers/categories.service';
import { BooksModule } from '../books/books.module';
import { AuthModule } from '../auth/auth.module';

import { CategoriesAdminController } from './categories-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category]),
    BooksModule,
    AuthModule,
  ],
  controllers: [CategoriesController, CategoriesAdminController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule { }
