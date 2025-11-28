import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { E2ETestHelper } from '../helpers';
import { DataSource } from 'typeorm';

describe('Checkout Flow (E2E)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authToken: string;
  let userId: string;
  let bookId: string;
  let variantId: string;

  beforeAll(async () => {
    await E2ETestHelper.beforeAll();
    app = E2ETestHelper.getApp();
    dataSource = app.get(DataSource);

    // Create test data
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
        email: 'test@example.com',
        password: 'Test123!',
        name: 'Test User',
      });

    userId = userResponse.body.user.id;
    authToken = userResponse.body.token;

    // Create test book with format variant
    const bookRepo = dataSource.getRepository('Book');
    const book = await bookRepo.save({
      title: 'Test Book for Checkout',
      description: 'A test book',
      genre: 'Fiction',
      visibility: 'public',
    });
    bookId = book.id;

    // Create book format variant with stock
    const variantRepo = dataSource.getRepository('BookFormatVariant');
    const variant = await variantRepo.save({
      bookId,
      format: 'EBOOK',
      price: 19.99,
      stockQuantity: 100,
      reservedQuantity: 0,
      isAvailable: true,
    });
    variantId = variant.id;
  }

  describe('Happy Path: Complete Checkout Flow', () => {
    it('should successfully complete checkout from cart to order', async () => {
      // Step 1: Add item to cart
      const addToCartResponse = await request(app.getHttpServer())
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          variantId,
          quantity: 2,
        })
        .expect(201);

      expect(addToCartResponse.body).toHaveProperty('cart');
      expect(addToCartResponse.body.cart.items).toHaveLength(1);
      expect(addToCartResponse.body.cart.items[0].quantity).toBe(2);

      // Verify stock reservation
      const variant = await dataSource
        .getRepository('BookFormatVariant')
        .findOne({ where: { id: variantId } });
      expect(variant.reservedQuantity).toBe(2);
      expect(variant.stockQuantity).toBe(100);

      // Step 2: Get cart to verify
      const getCartResponse = await request(app.getHttpServer())
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(getCartResponse.body.items).toHaveLength(1);
      expect(getCartResponse.body.totalAmount).toBe('39.98'); // 2 * 19.99

      // Step 3: Checkout
      const checkoutResponse = await request(app.getHttpServer())
        .post('/api/v1/cart/checkout')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          paymentProvider: 'phonepe',
          idempotencyKey: `test-${Date.now()}`,
        })
        .expect(201);

      expect(checkoutResponse.body).toHaveProperty('orderId');
      expect(checkoutResponse.body).toHaveProperty('paymentUrl');
      expect(checkoutResponse.body.status).toBe('PENDING');

      const orderId = checkoutResponse.body.orderId;

      // Step 4: Verify order created
      const order = await dataSource
        .getRepository('Order')
        .findOne({
          where: { id: orderId },
          relations: ['items'],
        });

      expect(order).toBeDefined();
      expect(order.payment_status).toBe('PENDING');
      expect(order.items).toHaveLength(1);
      expect(order.total_amount).toBe('39.98');

      // Step 5: Simulate successful payment webhook
      const webhookResponse = await request(app.getHttpServer())
        .post('/api/v1/cart/webhook/payment')
        .send({
          orderId,
          status: 'SUCCESS',
          transactionId: `txn_${Date.now()}`,
          provider: 'phonepe',
        })
        .expect(200);

      expect(webhookResponse.body.message).toContain('Payment processed');

      // Step 6: Verify order updated and stock finalized
      const updatedOrder = await dataSource
        .getRepository('Order')
        .findOne({ where: { id: orderId } });

      expect(updatedOrder.payment_status).toBe('PAID');

      // Verify stock was finalized (decremented)
      const finalVariant = await dataSource
        .getRepository('BookFormatVariant')
        .findOne({ where: { id: variantId } });

      expect(finalVariant.stockQuantity).toBe(98); // 100 - 2
      expect(finalVariant.reservedQuantity).toBe(0); // Released after payment

      // Step 7: Verify cart is cleared
      const cartAfterCheckout = await request(app.getHttpServer())
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cartAfterCheckout.body.items).toHaveLength(0);
    });
  });
});
