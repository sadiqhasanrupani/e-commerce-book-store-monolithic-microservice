import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';

import { BooksController } from './books.controller';

// providers
import { BooksService } from './providers/books.service';
import { CreateBookProvider } from './providers/create-book.provider';
import { UploadBookFilesProvider } from './providers/upload-book-files.provider';

import { GlobalConfigModule } from '@app/global-config';
import { DatabaseModule } from '@app/database';

import { ClientsModule } from '@nestjs/microservices';
import { Book } from '@app/contract/books/entities/book.entity';
import { Author } from '@app/contract/books/entities/author.entity';
import { BOOKS_CONFIG } from '@app/contract/books/config/books.config';
import { STORAGE_CONFIG } from '@app/contract/storage/configs/storage.config';

@Module({
  imports: [
    GlobalConfigModule,
    DatabaseModule,
    TypeOrmModule.forFeature([Book, Author]),
    ClientsModule.register([BOOKS_CONFIG.CLIENTS, STORAGE_CONFIG.CLIENTS]),
  ],
  controllers: [BooksController],
  providers: [BooksService, CreateBookProvider, UploadBookFilesProvider],
})
export class BooksModule { } //eslint-disable-line
