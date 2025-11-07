import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';

import { StorageModule } from './storage.module';
import { STORAGE_CONFIG } from '@app/contract/storage/configs/storage.config';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(StorageModule, {
    transport: STORAGE_CONFIG.CLIENTS.transport,
    options: {
      host: STORAGE_CONFIG.CLIENTS.options.host,
      port: STORAGE_CONFIG.CLIENTS.options.port,
    },
  });

  await app.listen();
}
bootstrap(); //eslint-disable-line
