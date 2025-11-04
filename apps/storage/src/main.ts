import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { StorageModule } from './storage.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    StorageModule,
    {
      transport: Transport.TCP,
      options: {
        port: 3003,
      },
    },
  );

  await app.listen();
}
bootstrap();
