import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MagicPagesApiGatewayModule } from './magic-pages-api-gateway.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from 'libs/common/src';
import { HybridValidationPipe } from 'libs/common/src/pipes/hybrid-validation.pipe';

async function bootstrap() {
  const logger = new Logger('BootStrap')

  const app = await NestFactory.create(MagicPagesApiGatewayModule, {
    bufferLogs: true,
    bodyParser: false, // Disable default body parser to handle raw body for webhooks
  });

  // Middleware to capture raw body
  const rawBodyMiddleware = (req, res, next) => {
    if (req.originalUrl.includes('/webhook')) {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        req.rawBody = data;
        next();
      });
    } else {
      next();
    }
  };

  // Use express body parser for other routes, but we need to handle raw body for webhooks
  // Actually, a better way is to use json() with verify
  const bodyParser = require('body-parser');
  app.use(bodyParser.json({
    verify: (req, res, buf) => {
      if (req.url.includes('/webhook')) {
        req.rawBody = buf;
      }
    }
  }));
  app.use(bodyParser.urlencoded({ extended: true }));

  app.useLogger(app.get(LoggerService));

  // Connect RabbitMQ microservice for consuming messages (e.g., email events)
  const configService = app.get(ConfigService);
  const rabbitmqUrl = configService.get<string>('RABBITMQ_URL');

  if (rabbitmqUrl) {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUrl],
        queue: 'magic-pages-queue',
        queueOptions: {
          durable: true,
        },
        noAck: false, // Enable manual acknowledgment
      },
    });
    logger.log('[Bootstrap] RabbitMQ microservice consumer connected');
  } else {
    logger.warn('[Bootstrap] RABBITMQ_URL not configured, email consumer disabled');
  }

  // adding a validation pipeline
  app.useGlobalPipes(new HybridValidationPipe());

  // enabling cors for public usage
  console.log('DEBUG: CORS_ORIGIN:', globalThis.process.env.CORS_ORIGIN);
  console.log('DEBUG: ORIGIN:', globalThis.process.env.ORIGIN);
  app.enableCors({
    origin: globalThis.process.env.CORS_ORIGIN ?? globalThis.process.env.ORIGIN,
    credentials: true,
  });

  // Swagger Setup
  const config = new DocumentBuilder()
    .setTitle('Magic Pages API')
    .setDescription('The Magic Pages API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // add a global suffix of api/v1
  const apiVersion = configService.get<string>('API_VERSION') || 'v1';
  app.setGlobalPrefix(`api/${apiVersion}`);

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
