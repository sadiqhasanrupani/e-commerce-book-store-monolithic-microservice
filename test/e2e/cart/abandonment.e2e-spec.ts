import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { E2ETestHelper } from '../helpers';
import { DataSource } from 'typeorm';

describe('Cart Abandonment & Reservation Release (E2E)', () => {
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
        email: 'abandonment@example.com',
        password: 'Test123!',
        name: 'Abandonment User',
      });

    authToken = userResponse.body.token;

    // Create test book with format variant
    const bookRepo = dataSource.getRepository('Book');
    const book = await bookRepo.save({
      title: 'Test Book - Abandonment',
      description: 'A test book for cart abandonment',
      genre: 'Fiction',
      visibility: 'public',
    });

    const variantRepo = dataSource.getRepository('BookFormatVariant');
    const variant = await variantRepo.save({
      bookId: book.id,
      format: 'EBOOK',
      price: 15.99,
      stockQuantity: 200,
      reservedQuantity: 0,
      isAvailable: true,
    });
    variantId = variant.id;
  });

describe('Cart Abandonment Flow', () => {
  it('should release reserved stock when cart is abandoned', async () => {
    // Add item to cart
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ variantId, quantity: 5 })
      .expect(201);

    // Verify stock is reserved
    let variant = await dataSource
      .getRepository('BookFormatVariant')
      .findOne({ where: { id: variantId } });
    expect(variant.reservedQuantity).toBe(5);

    // Get cart to mark it as COMPLETED (simulating abandoned checkout)
    const cart = await dataSource.getRepository('Cart').findOne({
      where: { status: 'ACTIVE' },
    });

    // Manually mark cart as COMPLETED to trigger reservation worker
    await dataSource.getRepository('Cart').update(cart.id, {
      status: 'COMPLETED',
      updatedAt: new Date(Date.now() - 16 * 60 * 1000), // 16 minutes ago
    });

    // Wait for reservation worker to process (or manually trigger)
    // In real scenario, the cron job would run every 15 minutes
    // For E2E, we can manually call the cleanup method
    const reservationWorker = app.get('ReservationWorkerService');
    await reservationWorker.releaseAbandonedReservations();

    // Verify reserved stock is released
    variant = await dataSource
      .getRepository('BookFormatVariant')
      .findOne({ where: { id: variantId } });
    expect(variant.reservedQuantity).toBe(0);
    expect(variant.stockQuantity).toBe(200); // Unchanged
  });

  it('should clear cart items when user explicitly clears cart', async () => {
    // Add items to cart
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ variantId, quantity: 3 })
      .expect(201);

    // Clear cart
    await request(app.getHttpServer())
      .post('/api/v1/cart/clear')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // Verify cart is empty
    const cartResponse = await request(app.getHttpServer())
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(cartResponse.body.items).toHaveLength(0);

    // Verify reservations are released
    const variant = await dataSource
      .getRepository('BookFormatVariant')
      .findOne({ where: { id: variantId } });
    expect(variant.reservedQuantity).toBe(0);
  });
});
});
