import { Module, DynamicModule, Provider } from '@nestjs/common';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { RABBITMQ_CLIENT } from './constants/rmq.constant';

// types
import { RegisterOption } from './types/register-option.type';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({})
/**
 * Adding a dynamic module
 * */
export class RmqModule {
  static register(options: RegisterOption): DynamicModule {
    const clientProvider: Provider<ClientProxy> = {
      provide: RABBITMQ_CLIENT,
      useFactory: (): ClientProxy => {
        return ClientProxyFactory.create({
          transport: Transport.RMQ,
          options: {
            urls: options.urls,
            queue: options.queue ?? 'magic-pages-queue',
            queueOptions: {
              durable: true
            },
          },
        });
      },
    }

    return {
      module: RmqModule,
      providers: [clientProvider],
      exports: [clientProvider]
    }
  }

  static registerAsync(): DynamicModule {
    const clientProvider: Provider<ClientProxy> = {
      provide: RABBITMQ_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): ClientProxy => {
        return ClientProxyFactory.create({
          transport: Transport.RMQ,
          options: {
            urls: [configService.getOrThrow<string>('rabbitmq.url')],
            queue: configService.getOrThrow<string>('rabbitmq.queue') ?? 'magic-pages-queue',
            queueOptions: {
              durable: true
            },
          },
        });
      },
    }

    return {
      module: RmqModule,
      imports: [ConfigModule],
      providers: [clientProvider],
      exports: [clientProvider]
    }
  }
}
