import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '@app/contract/books/entities/categories.entity';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './providers/categories.service';
import { BooksModule } from '../books/books.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category]),
    BooksModule,
    AuthModule,
  ],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule { }
