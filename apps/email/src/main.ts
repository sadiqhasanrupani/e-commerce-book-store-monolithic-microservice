import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { EmailModule } from './email.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(EmailModule, {
    transport: Transport.TCP,
    options: {
      host: process.env.EMAIL_HOST || '127.0.0.1',
      port: Number(process.env.EMAIL_PORT) || 4001,
    },
  });
  await app.listen();
}
bootstrap();
