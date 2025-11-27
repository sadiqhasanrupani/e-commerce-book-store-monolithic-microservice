import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MagicPagesApiGatewayModule } from '../../apps/magic-pages-api-gateway/src/magic-pages-api-gateway.module';
import { setupTestDatabase, teardownTestDatabase } from './setup';

export class E2ETestHelper {
  static app: INestApplication;
  static moduleRef: TestingModule;

  static async beforeAll() {
    // Setup test database
    await setupTestDatabase();

    // Create testing module
    this.moduleRef = await Test.createTestingModule({
      imports: [MagicPagesApiGatewayModule],
    }).compile();

    this.app = this.moduleRef.createNestApplication();
    await this.app.init();
  }

  static async afterAll() {
    await this.app?.close();
    await teardownTestDatabase();
  }

  static getApp(): INestApplication {
    return this.app;
  }
}
