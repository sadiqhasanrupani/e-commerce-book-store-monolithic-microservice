import { NestFactory } from '@nestjs/core';
import { MagicPagesApiGatewayModule } from './magic-pages-api-gateway.module';

async function bootstrap() {
  const app = await NestFactory.create(MagicPagesApiGatewayModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
