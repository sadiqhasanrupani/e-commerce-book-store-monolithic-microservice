import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';

// modules
import { UploadModule } from '../upload/upload.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaginationModule } from '../common/pagination/pagination.module';

// controllers
import { BooksController } from './books.controller';

// providers
import { BooksService } from './providers/books.service';
import { CreateBookProvider } from './providers/create-book.provider';
import { UploadBookFilesProvider } from './providers/upload-book-files.provider';
import { DeleteBookProvider } from './providers/delete-book.provider';
import { FindBookProvider } from './providers/find-book.provider';

// entities
import { Book } from '@app/contract/books/entities/book.entity';

// configs
import { STORAGE_CONFIG } from '@app/contract/storage/configs/storage.config';
import { Author } from '@app/contract/books/entities/author.entity';
import { BoookMetricsProvider } from './providers/book-metrics.provider';
import { BookMetrics } from '@app/contract/books/entities/book-metrics.entity';

@Module({
  imports: [
    UploadModule,
    ClientsModule.register([STORAGE_CONFIG.CLIENTS]),
    TypeOrmModule.forFeature([Book, Author, BookMetrics]),
    PaginationModule,
  ],
  controllers: [BooksController],
  providers: [
    BooksService,
    CreateBookProvider,
    UploadBookFilesProvider,
    DeleteBookProvider,
    FindBookProvider,
    BoookMetricsProvider
  ],
  exports: [BooksService, TypeOrmModule]
})
export class BooksModule { }
