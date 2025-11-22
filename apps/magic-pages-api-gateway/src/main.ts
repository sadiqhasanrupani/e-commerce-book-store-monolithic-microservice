import { NestFactory } from '@nestjs/core';
import { MagicPagesApiGatewayModule } from './magic-pages-api-gateway.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(MagicPagesApiGatewayModule);

  // add a global suffix of api/v1
  app.setGlobalPrefix(`api/${globalThis.process.env.API_VERSION}`);

  // adding a validation pipeline
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // enabling cors for public usage
  app.enableCors({
    origin: globalThis.process.env.ORIGIN,
    credentials: true
  });

  await app.listen(process.env.PORT ?? 8080);
}
bootstrap(); // eslint-disable-line
