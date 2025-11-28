import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MagicPagesApiGatewayModule } from './magic-pages-api-gateway.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from 'libs/common/src';

async function bootstrap() {
  const logger = new Logger('BootStrap')

  const app = await NestFactory.create(MagicPagesApiGatewayModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(LoggerService));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      }
    }),
  );

  // Connect to RabbitMQ as a microservice for event consumers
  const configService = app.get(ConfigService);
  const rabbitmqUrl = configService.get<string>('rabbitmq.url');
  const rabbitmqQueue = configService.get<string>('rabbitmq.queue') ?? 'magic-pages-queue';

  logger.log('[Bootstrap] RabbitMQ URL:', rabbitmqUrl);
  logger.log('[Bootstrap] RabbitMQ Queue:', rabbitmqQueue);

  if (!rabbitmqUrl) {
    logger.error('[Bootstrap] RABBITMQ_URL is not configured!');
    throw new Error('RABBITMQ_URL environment variable is required');
  }

  try {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUrl],
        queue: rabbitmqQueue,
        queueOptions: {
          durable: true,
        },
      },
    });
    logger.log('[Bootstrap] Microservice connection configured successfully');
  } catch (error) {
    logger.error('[Bootstrap] Failed to configure microservice:', error);
    throw error;
  }

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
    credentials: true,
  });

  // Start HTTP server first
  await app.listen(globalThis.process.env.PORT ?? 8080);
  logger.log(`[Bootstrap] HTTP Server is running on: http://localhost:${globalThis.process.env.PORT ?? 8080}`);

  // Start microservices in background (non-blocking)
  app.startAllMicroservices()
    .then(() => {
      logger.log('[Bootstrap] All microservices started successfully');
    })
    .catch((error) => {
      logger.error('[Bootstrap] Failed to start microservices:', error);
      logger.warn('[Bootstrap] Application will continue without RabbitMQ consumer');
    });
}
bootstrap(); // eslint-disable-line
