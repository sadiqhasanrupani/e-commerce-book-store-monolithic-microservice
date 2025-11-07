import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';

import { BOOKS_CONFIG } from '@app/contract/books/config/books.config';

import { BooksService } from './books.service';
import { BooksController } from './books.controller';
import { UploadModule } from '../upload/upload.module';

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
  providers: [BooksService],
})
export class BooksModule { } //eslint-disable-line
