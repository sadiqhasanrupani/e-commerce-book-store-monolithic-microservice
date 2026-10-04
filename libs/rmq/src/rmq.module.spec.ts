import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { jest, describe, beforeEach, expect, it } from '@jest/globals';
import { RmqModule } from './rmq.module';
import { RABBITMQ_CLIENT } from './constants/rmq.constant';

describe('RmqModule', () => {
  let moduleRef: TestingModule;
  let configMock: Partial<ConfigService>;

  beforeEach(async () => {
    // The factory reads the url with getOrThrow (required) and the queue with
    // get (it has a code-level default), so the double must provide BOTH. With
    // only getOrThrow stubbed, the factory threw "configService.get is not a
    // function" and the failure looked like a config problem rather than a
    // spec problem.
    configMock = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'rabbitmq.url') return 'amqp://localhost';
        return undefined as any;
      }),
      get: jest.fn((key: string) => {
        if (key === 'rabbitmq.queue') return 'test-queue';
        return undefined as any;
      }),
    };

    moduleRef = await Test.createTestingModule({
      imports: [RmqModule.register({ urls: ['amqp://localhost'] }), RmqModule.registerAsync()],
    })
      .overrideProvider(ConfigService)
      .useValue(configMock)
      .compile();
  });

  it('should create RMQ client', () => {
    const client = moduleRef.get(RABBITMQ_CLIENT);

    expect(client).toBeDefined();
    expect(configMock.getOrThrow).toHaveBeenCalledWith('rabbitmq.url');
    // Queue is read with `get`, not `getOrThrow` — it falls back to
    // 'magic-pages-queue' when unset.
    expect(configMock.get).toHaveBeenCalledWith('rabbitmq.queue');
  });
});
