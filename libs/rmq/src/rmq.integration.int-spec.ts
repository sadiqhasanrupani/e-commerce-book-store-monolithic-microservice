import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { RmqModule } from './rmq.module';
import { RABBITMQ_CLIENT } from './constants/rmq.constant';
import { ClientProxy } from '@nestjs/microservices';
import { describe, it, expect, beforeAll } from '@jest/globals';

describe('RabbitMQ Integration - Publish Message', () => {
  let rmqClient: ClientProxy;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          envFilePath: '.env.integration',
          isGlobal: true,
        }),
        RmqModule.registerAsync(),
      ],
    }).compile();

    rmqClient = moduleRef.get<ClientProxy>(RABBITMQ_CLIENT);
  });

  it('should publish a message to RabbitMQ', async () => {
    const payload = { id: 1, name: 'IntegrationTest' };

    const result = await rmqClient.emit('test.event', payload).toPromise();

    // In emit(), real RMQ returns void, so we just need to check no errors
    expect(result).toBeUndefined();
  });
});
