import { NestFactory } from '@nestjs/core';
import { MagicPagesApiGatewayModule } from './magic-pages-api-gateway.module';
import { ValidationPipe } from '@nestjs/common';


async function bootstrap() {
  const app = await NestFactory.create(MagicPagesApiGatewayModule);

  // add a global suffix of api/v1
  app.setGlobalPrefix('api/${process.env.API_VERSION}');

  // adding a validation pipeline
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  )

  // enabling cors for public usage
  app.enableCors();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
