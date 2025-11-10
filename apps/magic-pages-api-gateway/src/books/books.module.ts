import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';

// modules
import { UploadModule } from '../upload/upload.module';
import { TypeOrmModule } from '@nestjs/typeorm';

// controllers
import { BooksController } from './books.controller';

// providers
import { BooksService } from './providers/books.service';
import { CreateBookProvider } from './providers/create-book.provider';
import { UploadBookFilesProvider } from './providers/upload-book-files.provider';
import { DeleteBookProvider } from './providers/delete-book.provider';

// entities
import { Book } from '@app/contract/books/entities/book.entity';

// configs
import { STORAGE_CONFIG } from '@app/contract/storage/configs/storage.config';
import { Author } from '@app/contract/books/entities/author.entity';

@Module({
  imports: [
    UploadModule,
    ClientsModule.register([STORAGE_CONFIG.CLIENTS]),
    TypeOrmModule.forFeature([Book, Author])
  ],
  controllers: [BooksController],
  providers: [BooksService, CreateBookProvider, UploadBookFilesProvider, DeleteBookProvider],
  exports: [BooksService, TypeOrmModule]
})
export class BooksModule { } //eslint-disable-line
