import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';

// modules
import { UploadModule } from '../upload/upload.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaginationModule } from '../common/pagination/pagination.module';
import { AuthModule } from '../auth/auth.module';

// controllers
import { BooksController } from './books.controller';
import { BooksAdminController } from './books-admin.controller';

// providers
import { BooksService } from './providers/books.service';
import { CreateBookProvider } from './providers/create-book.provider';
import { UploadBookFilesProvider } from './providers/upload-book-files.provider';
import { DeleteBookProvider } from './providers/delete-book.provider';
import { FindBookProvider } from './providers/find-book.provider';

// entities
import { Book } from '@app/contract/books/entities/book.entity';
import { BookMetric } from '@app/contract/books/entities/book-metrics.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Category } from '@app/contract/books/entities/categories.entity';
import { Tag } from '@app/contract/books/entities/tags.entity';
import { Author } from '@app/contract/author/entities/author.entity';

// configs
import { STORAGE_CONFIG } from '@app/contract/storage/configs/storage.config';
// import { BoookMetricsProvider } from './providers/book-metrics.provider';

@Module({
  imports: [
    UploadModule,
    ClientsModule.register([STORAGE_CONFIG.CLIENTS]),
    TypeOrmModule.forFeature([Book, Author, BookMetric, BookFormatVariant, Category, Tag]),
    PaginationModule,
    AuthModule,
  ],
  controllers: [BooksController, BooksAdminController],
  providers: [BooksService, CreateBookProvider, UploadBookFilesProvider, DeleteBookProvider, FindBookProvider],
  exports: [BooksService, TypeOrmModule],
})
export class BooksModule { }
