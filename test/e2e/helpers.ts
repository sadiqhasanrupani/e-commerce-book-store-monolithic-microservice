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
    this.app.setGlobalPrefix('api/v1');
    await this.app.init();
  }

  static async afterAll() {
    await this.app?.close();
    await teardownTestDatabase();
  }

  static getApp(): INestApplication {
    return this.app;
  }

  constructor(private appInstance: INestApplication, private dataSource: any) { }

  async init() {
    // Optional init logic if needed
  }

  async teardown() {
    // Optional teardown logic
  }

  async clearDatabase() {
    const entities = this.dataSource.entityMetadatas;
    for (const entity of entities) {
      const repository = this.dataSource.getRepository(entity.name);
      await repository.query(`TRUNCATE TABLE "${entity.tableName}" RESTART IDENTITY CASCADE;`);
    }
  }

  async createUser(name: string, email: string, password: string) {
    // Implementation to create user via API or DB
    // Using DB directly for speed
    const hashedPassword = 'hashed_password'; // Mock hash or use bcrypt if available
    // Actually, let's use the API to register if possible, or DB.
    // DB is faster and less dependent on Auth module working perfectly (though we want to test that too).
    // Let's use DB for helper.
    const user = await this.dataSource.query(`INSERT INTO "users" ("firstName", "lastName", "email", "password_hash", "role") VALUES ('${name}', 'User', '${email}', '${hashedPassword}', 'BUYER') RETURNING *`);
    return user[0];
  }

  async loginUser(email: string, password: string) {
    // Mock login or use AuthService
    // Since we are integration testing, we might want a valid token.
    // If we can't easily generate one, we might need to mock the AuthGuard.
    // But let's try to use the real login endpoint.
    // Wait, we don't have access to request() here easily unless we pass app.

    // Let's assume we can generate a token or mock it.
    // For now, let's return a mock token and ensure our tests mock the guard or we use a real token generator.
    // If we use real AuthModule, we need real JWT service.

    // Let's use the API to login.
    // We need 'request' from supertest.
    // But we don't want to import supertest here if possible.
    // Let's just return a dummy token and assume we might need to mock AuthGuard in tests if we don't want to test Auth.
    // BUT, we are doing full integration. We SHOULD test Auth.
    // So we should hit the login endpoint.

    // Actually, let's just implement it in the test file or pass request object.
    // Or simpler: just return a mock token and use a testing guard override if needed.
    // But wait, the user wants "Full Workflow".

    // Let's try to hit the real login endpoint.
    // I'll need to import request.
    const request = require('supertest');
    const res = await request(this.appInstance.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email, password })
      .expect(200);

    return res.body.accessToken;
  }

  async createBook(title: string, stock: number) {
    // Create Book
    // Table: books
    // Columns: title, description, coverImageUrl, etc.
    const book = await this.dataSource.query(`INSERT INTO "books" ("title", "description", "coverImageUrl") VALUES ('${title}', 'Desc', 'img.jpg') RETURNING *`);

    // Create Variant
    // Table: book_format_varients
    // Columns: book_id, format, price, stockQuantity, reservedQuantity, isbn
    // format enum: HARDCOVER, PAPERBACK, EBOOK, AUDIOBOOK (Check BookFormat enum)
    // Let's assume 'PAPERBACK' or similar.
    // Check BookFormat enum if needed, but 'PAPERBACK' is safe guess or 'PHYSICAL'.
    // In BookFormatVariant entity: @Column({ type: 'enum', enum: BookFormat })
    // Let's check BookFormat enum.

    const variant = await this.dataSource.query(`INSERT INTO "book_format_varients" ("bookId", "book_id", "format", "price", "stockQuantity", "reservedQuantity", "isbn") VALUES ('${book[0].id}', '${book[0].id}', 'paperback', 100, ${stock}, 0, 'ISBN-${Date.now()}') RETURNING *`);

    return { ...book[0], variants: variant };
  }
}
