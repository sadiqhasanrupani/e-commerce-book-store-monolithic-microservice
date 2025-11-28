import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { MagicPagesApiGatewayModule } from '../../../apps/magic-pages-api-gateway/src/magic-pages-api-gateway.module';
import { DataSource, QueryRunner } from 'typeorm';
import { E2ETestHelper } from '../../e2e/helpers';
import { Cart } from '../../../libs/contract/src/carts/entities/cart.entity';
import { CartItem } from '../../../libs/contract/src/carts/entities/cart-item.entity';
import { BookFormatVariant } from '../../../libs/contract/src/books/entities/book-format-varient.entity';
import { CartStatus } from '../../../libs/contract/src/carts/enums/cart-status.enum';

describe('Cart Database Integration', () => {
  let app: INestApplication;
  let helper: E2ETestHelper;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MagicPagesApiGatewayModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    helper = new E2ETestHelper(app, dataSource);
    await helper.init();
  });

  afterAll(async () => {
    await helper.teardown();
    await app.close();
  });

  beforeEach(async () => {
    await helper.clearDatabase();
  });

  it('should rollback transaction if any step fails during checkout', async () => {
    // 1. Setup
    const user = await helper.createUser('dbtest', 'db@example.com', 'password');
    const book = await helper.createBook('DB Test Book', 10);
    const variant = book.variants[0];

    // 2. Create Cart and Item manually
    const cart = new Cart();
    cart.userId = user.id;
    cart.status = CartStatus.ACTIVE;
    await dataSource.manager.save(Cart, cart);

    const cartItem = new CartItem();
    cartItem.cart = cart;
    cartItem.bookFormatVariant = variant;
    cartItem.qty = 5;
    cartItem.unitPrice = 100;
    await dataSource.manager.save(CartItem, cartItem);

    // 3. Simulate Transaction Failure
    // We'll use a manual transaction to verify rollback behavior
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Step 1: Decrement stock (Success)
      await queryRunner.manager.decrement(BookFormatVariant, { id: variant.id }, 'stockQuantity', 5);

      // Verify intermediate state
      const updatedVariant = await queryRunner.manager.findOne(BookFormatVariant, { where: { id: variant.id } });
      expect(updatedVariant).toBeDefined();
      expect(updatedVariant!.stockQuantity).toBe(5); // 10 - 5

      // Step 2: Force Error (e.g., duplicate key or constraint violation)
      // Trying to insert invalid data
      await queryRunner.manager.query('INSERT INTO "non_existent_table" VALUES (1)');

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }

    // 4. Verify Rollback
    const finalVariant = await dataSource.manager.findOne(BookFormatVariant, { where: { id: variant.id } });
    expect(finalVariant).toBeDefined();
    expect(finalVariant!.stockQuantity).toBe(10); // Should be rolled back to original
  });

  it('should enforce foreign key constraints', async () => {
    // Try to create cart item for non-existent cart
    const cartItem = new CartItem();
    cartItem.cart = { id: 99999 } as unknown as Cart; // Non-existent
    cartItem.bookFormatVariant = { id: 1 } as BookFormatVariant;
    cartItem.qty = 1;
    cartItem.unitPrice = 100;

    await expect(dataSource.manager.save(CartItem, cartItem)).rejects.toThrow();
  });
});
