import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { jest, describe, beforeEach, expect, it } from '@jest/globals';
import { RmqModule } from "./rmq.module";
import { RABBITMQ_CLIENT } from "./constants/rmq.constant";

describe('RmqModule', () => {
  let moduleRef: TestingModule;
  let configMock: Partial<ConfigService>;

  beforeEach(async () => {
    configMock = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'rabbitmq.url') return 'amqp://localhost';
        if (key === 'rabbitmq.queue') return 'test-queue';
      })
    }

    moduleRef = await Test.createTestingModule({
      imports: [RmqModule.register({ urls: ['amqp://localhost'] }), RmqModule.registerAsync()],
    })
      .overrideProvider(ConfigService)
      .useValue(configMock)
      .compile()
  });

  it('should create RMQ client', () => {
    const client = moduleRef.get(RABBITMQ_CLIENT);

    expect(client).toBeDefined();
    expect(configMock.getOrThrow).toHaveBeenCalledWith('rabbitmq.url')
    expect(configMock.getOrThrow).toHaveBeenCalledWith('rabbitmq.queue')
  });

})
