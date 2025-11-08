import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';

// modules
import { UploadModule } from '../upload/upload.module';

// controllers
import { BooksController } from './books.controller';

// providers
import { BooksService } from './providers/books.service';
import { CreateBookProvider } from './providers/create-book.provider';

// configs
import { BOOKS_CONFIG } from '@app/contract/books/config/books.config';

@Module({
  imports: [
    UploadModule,
    ClientsModule.register([
      {
        name: BOOKS_CONFIG.CLIENTS.name,
        transport: BOOKS_CONFIG.CLIENTS.transport,
        options: {
          port: BOOKS_CONFIG.CLIENTS.options.port,
          host: BOOKS_CONFIG.CLIENTS.options.host,
        },
      },
    ]),
  ],
  controllers: [BooksController],
  providers: [BooksService, CreateBookProvider],
})
export class BooksModule { } //eslint-disable-line
