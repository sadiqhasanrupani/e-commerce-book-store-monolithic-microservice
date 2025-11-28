import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { E2ETestHelper } from '../helpers';
import { DataSource } from 'typeorm';

describe('Checkout - Payment Failure & Rollback (E2E)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authToken: string;
  let variantId: string;

  beforeAll(async () => {
    await E2ETestHelper.beforeAll();
    app = E2ETestHelper.getApp();
    dataSource = app.get(DataSource);
    await seedTestData();
  });

  afterAll(async () => {
    await E2ETestHelper.afterAll();
  });

  async function seedTestData() {
    // Create test user
    const userResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'payment-fail@example.com',
        password: 'Test123!',
        name: 'Payment Fail User',
      });

    authToken = userResponse.body.token;

    // Create test book with format variant
    const bookRepo = dataSource.getRepository('Book');
    const book = await bookRepo.save({
      title: 'Test Book - Payment Failure',
      description: 'A test book for payment failure',
      genre: 'Fiction',
      visibility: 'public',
    });

    // Create book format variant with limited stock
    const variantRepo = dataSource.getRepository('BookFormatVariant');
    const variant = await variantRepo.save({
      bookId: book.id,
      format: 'EBOOK',
      price: 29.99,
      stockQuantity: 50,
      reservedQuantity: 0,
      isAvailable: true,
    });
    variantId = variant.id;
  }

  describe('Payment Failure Handling', () => {
    it('should keep order in PENDING status when payment fails', async () => {
      // Add item to cart
      await request(app.getHttpServer())
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ variantId, quantity: 3 })
        .expect(201);

      // Checkout
      const checkoutResponse = await request(app.getHttpServer())
        .post('/api/v1/cart/checkout')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          paymentProvider: 'phonepe',
          idempotencyKey: `fail-test-${Date.now()}`,
        })
        .expect(201);

      const orderId = checkoutResponse.body.orderId;

      // Simulate failed payment webhook
      await request(app.getHttpServer())
        .post('/api/v1/cart/webhook/payment')
        .send({
          orderId,
          status: 'FAILED',
          transactionId: `txn_fail_${Date.now()}`,
          provider: 'phonepe',
        })
        .expect(200);

      // Verify order status remains PENDING (not PAID)
      const order = await dataSource
        .getRepository('Order')
        .findOne({ where: { id: orderId } });

      expect(order.payment_status).toBe('FAILED');

      // Verify stock was NOT finalized (still reserved)
      const variant = await dataSource
        .getRepository('BookFormatVariant')
        .findOne({ where: { id: variantId } });

      expect(variant.stockQuantity).toBe(50); // Not decremented
      expect(variant.reservedQuantity).toBe(3); // Still reserved
    });

    it('should handle insufficient stock during checkout', async () => {
      // Try to checkout with quantity exceeding available stock
      await request(app.getHttpServer())
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ variantId, quantity: 100 }) // More than available (50)
        .expect(400); // Should fail with bad request
    });
  });
});
