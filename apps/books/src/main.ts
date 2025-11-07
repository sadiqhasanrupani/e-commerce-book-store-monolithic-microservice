import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';

import { BooksModule } from './books.module';
import { BOOKS_CONFIG } from '@app/contract/books/config/books.config';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(BooksModule, {
    transport: BOOKS_CONFIG.CLIENTS.transport,
    options: { port: BOOKS_CONFIG.CLIENTS.options.port, host: BOOKS_CONFIG.CLIENTS.options.host },
  });
  await app.listen();
  console.log('Books microservice listening on 127.0.0.1:3001');
}
bootstrap(); //eslint-disable-line
