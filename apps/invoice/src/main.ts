import { NestFactory } from '@nestjs/core';
import { InvoiceModule } from './invoice.module';

async function bootstrap() {
  const app = await NestFactory.create(InvoiceModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
