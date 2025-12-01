import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddIsStockReservedToCartItem1764488531000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'cart_items',
      new TableColumn({
        name: 'is_stock_reserved',
        type: 'boolean',
        default: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('cart_items', 'is_stock_reserved');
  }
}
