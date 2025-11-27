import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { Order, PaymentStatus } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { CheckoutDto } from '@app/contract/carts/dtos/checkout.dto';
import {
  IPaymentProvider,
  PaymentInitiationResponse,
} from '../interfaces/payment-provider.interface';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { CartErrorCode } from '@app/contract/carts/enums/cart-error-code.enum';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(BookFormatVariant)
    private readonly variantRepository: Repository<BookFormatVariant>,
    private readonly dataSource: DataSource,
    @Inject('PAYMENT_PROVIDER')
    private readonly paymentProvider: IPaymentProvider,
  ) { }

  async checkout(
    userId: number,
    dto: CheckoutDto,
    idempotencyKey?: string,
  ): Promise<PaymentInitiationResponse> {
    this.logger.log(`Initiating checkout for user ${userId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Find Cart (Locking handled by optimistic locking or explicit lock if needed)
      // For checkout, we want to ensure no one else modifies the cart
      const cart = await queryRunner.manager.findOne(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
        relations: ['items', 'items.bookFormatVariant'],
        lock: { mode: 'pessimistic_write' }, // Lock cart to prevent updates
      });

      if (!cart) {
        throw new NotFoundException({
          code: CartErrorCode.CART_NOT_FOUND,
          message: 'Active cart not found',
        });
      }

      if (cart.items.length === 0) {
        throw new ConflictException({
          code: CartErrorCode.CART_EMPTY,
          message: 'Cart is empty',
        });
      }

      // 2. Validate Stock and Calculate Total
      let totalAmount = 0;
      const orderItems: OrderItem[] = [];

      for (const cartItem of cart.items) {
        const variant = cartItem.bookFormatVariant;

        if (!variant) {
          throw new NotFoundException({
            code: CartErrorCode.CART_ITEM_NOT_FOUND,
            message: `Product for item ${cartItem.id} not found`,
          });
        }

        // Lock variant row to prevent overselling
        const lockedVariant = await queryRunner.manager.findOne(BookFormatVariant, {
          where: { id: variant.id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!lockedVariant) {
          throw new NotFoundException({
            code: CartErrorCode.CART_ITEM_NOT_FOUND,
            message: `Variant ${variant.id} not found`,
          });
        }

        if (isPhysicalFormat(lockedVariant.format)) {
          // Check available stock (stock - reserved)
          // Note: Since we are in checkout, we might have already reserved stock in add-to-cart
          // But we need to verify if we can fulfill this order finally
          // Actually, add-to-cart increments reservedQuantity.
          // So available = stockQuantity - reservedQuantity + (our reserved quantity for this cart)
          // But simpler check: stockQuantity >= reservedQuantity (which should hold true)
          // And we are about to decrement stockQuantity.

          // Wait, if we reserved it, it's in reservedQuantity.
          // When we sell, we decrement stockQuantity AND reservedQuantity.

          if (lockedVariant.stockQuantity < cartItem.qty) {
            throw new ConflictException({
              code: CartErrorCode.INSUFFICIENT_STOCK,
              message: `Insufficient stock for ${cartItem.title}`,
              details: {
                variantId: variant.id,
                requested: cartItem.qty,
                available: lockedVariant.stockQuantity // This is total physical stock
              }
            });
          }
        }

        totalAmount += Number(cartItem.unitPrice) * cartItem.qty;

        // Create Order Item
        const orderItem = new OrderItem();
        orderItem.bookFormatVariant = variant;
        orderItem.quantity = cartItem.qty;
        orderItem.unit_price = Number(cartItem.unitPrice);
        orderItem.total_price = Number(cartItem.unitPrice) * cartItem.qty;
        orderItems.push(orderItem);
      }

      // 3. Create Order
      const order = new Order();
      order.user = { id: userId } as any;
      order.total_amount = totalAmount;
      order.payment_status = PaymentStatus.PENDING;
      // order.shipping_address = dto.shippingAddress; // Assuming Order has this field or we store it elsewhere
      // For now, ignoring address storage on Order entity as it wasn't in the entity definition I saw earlier.
      // TODO: Add shipping address to Order entity

      const savedOrder = await queryRunner.manager.save(Order, order);

      // 4. Save Order Items
      for (const item of orderItems) {
        item.order = savedOrder;
        await queryRunner.manager.save(OrderItem, item);
      }

      // 5. Update Stock
      for (const cartItem of cart.items) {
        const variant = cartItem.bookFormatVariant;
        if (isPhysicalFormat(variant.format)) {
          // Decrement stockQuantity AND reservedQuantity
          await queryRunner.manager.decrement(
            BookFormatVariant,
            { id: variant.id },
            'stockQuantity',
            cartItem.qty
          );
          await queryRunner.manager.decrement(
            BookFormatVariant,
            { id: variant.id },
            'reservedQuantity',
            cartItem.qty
          );
        }
      }

      // 6. Update Cart Status
      cart.status = CartStatus.CHECKOUT;
      cart.checkoutStartedAt = new Date();
      await queryRunner.manager.save(Cart, cart);

      await queryRunner.commitTransaction();

      // 7. Initiate Payment (Outside DB transaction to avoid long locks)
      try {
        const paymentResponse = await this.paymentProvider.initiatePayment({
          orderId: savedOrder.id.toString(),
          amount: totalAmount,
          currency: 'INR',
          customerPhone: dto.shippingAddress.phone,
          callbackUrl: `${process.env.APP_URL}/cart/webhook/payment`, // TODO: Config
          metadata: { userId, cartId: cart.id },
        });

        return paymentResponse;
      } catch (error) {
        // If payment initiation fails, we might want to fail the order or keep it pending?
        // For now, let's log and rethrow. The order exists in PENDING state.
        // User can retry payment.
        this.logger.error(`Payment initiation failed for order ${savedOrder.id}`, error);
        throw error;
      }

    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Checkout failed', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
