import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from "@nestjs/microservices";

import { AuthAppModule } from './auth-app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AuthAppModule,
    {
      transport: Transport.TCP,
      options: {
        port: 3002,
      }
    }
  )

  await app.listen()
}
bootstrap();
