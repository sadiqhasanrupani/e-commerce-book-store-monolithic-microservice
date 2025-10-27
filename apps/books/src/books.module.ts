import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';

import { BooksController } from './books.controller';

// providers
import { BooksService } from './providers/books.service';
import { CreateBookProvider } from './providers/create-book.provider';
import { UploadBookFilesProvider } from './providers/upload-book-files.provider';

import { GlobalConfigModule } from '@app/global-config';
import { DatabaseModule } from '@app/database';

import { ClientsModule, Transport } from '@nestjs/microservices';
import { Book } from '@app/contract/books/entities/book.entity';
import { Author } from '@app/contract/books/entities/author.entity';

@Module({
  imports: [
    GlobalConfigModule,
    DatabaseModule,
    TypeOrmModule.forFeature([Book, Author]),
    ClientsModule.register([
      {
        name: 'STORAGE_CLIENT',
        transport: Transport.TCP,
        options: {
          port: 3003,
        },
      },
    ]),
  ],
  controllers: [BooksController],
  providers: [BooksService, CreateBookProvider, UploadBookFilesProvider],
})
export class BooksModule { }
