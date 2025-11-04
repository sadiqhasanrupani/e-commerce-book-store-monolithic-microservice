import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { BOOK_PATTERNS } from '@app/contract/books/patterns/books.pattern';

import { BooksService } from './books.service';
import { BooksController } from './books.controller';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    UploadModule,
    ClientsModule.register([
      {
        name: BOOK_PATTERNS.REGISTER,
        transport: Transport.TCP,
        options: {
          port: BOOK_PATTERNS.PORT,
          host: BOOK_PATTERNS.HOST,
        }
      }
    ])
  ],
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule { }
