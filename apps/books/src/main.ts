import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { BooksModule } from './books.module';
import { BOOK_PATTERNS } from '@app/contract/books/patterns/books.pattern';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    BooksModule,
    {
      transport: Transport.TCP,
      options: { port: BOOK_PATTERNS.PORT, host: BOOK_PATTERNS.HOST },
    },
  );
  await app.listen();
  console.log('✅ Books microservice listening on 127.0.0.1:3001');
}
bootstrap();
