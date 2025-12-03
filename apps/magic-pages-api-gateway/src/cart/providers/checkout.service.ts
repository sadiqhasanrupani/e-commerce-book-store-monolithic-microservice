import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { Order } from '@app/contract/orders/entities/order.entity';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { CheckoutDto } from '@app/contract/carts/dtos/checkout.dto';
import { IPaymentProvider, PaymentInitiationResponse, PaymentProvider } from '../interfaces/payment-provider.interface';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { CartErrorCode } from '@app/contract/carts/enums/cart-error-code.enum';
import { CartMetricsService } from '../metrics/cart-metrics.service';
import { PhonePeProvider } from './phonepe.provider';
import { RazorpayProvider } from './razorpay.provider';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';

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
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly dataSource: DataSource,
    private readonly phonePeProvider: PhonePeProvider,
    private readonly razorpayProvider: RazorpayProvider,
    private readonly metricsService: CartMetricsService,
  ) { }

  async checkout(userId: number, dto: CheckoutDto, idempotencyKey?: string): Promise<PaymentInitiationResponse> {
    const startTime = Date.now();
    this.metricsService.incrementCheckoutRequest('pending');
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
          // JIT Validation & Re-reservation
          if (!cartItem.isStockReserved) {
            // Item is in cart but reservation expired. Check if we can re-reserve.
            const availableStock = lockedVariant.stockQuantity - lockedVariant.reservedQuantity;

            if (availableStock < cartItem.qty) {
              throw new ConflictException({
                code: CartErrorCode.INSUFFICIENT_STOCK,
                message: `Insufficient stock for ${cartItem.title}`,
                details: {
                  variantId: variant.id,
                  requested: cartItem.qty,
                  available: availableStock,
                },
              });
            }

            // Re-reserve stock (JIT)
            // We increment reservedQuantity now, so that the final decrement step works correctly
            await queryRunner.manager.increment(BookFormatVariant, { id: variant.id }, 'reservedQuantity', cartItem.qty);

            // Log this event?
            this.logger.log(`JIT Re-reservation successful for item ${cartItem.id} (Qty: ${cartItem.qty})`);
          } else {
            // Already reserved. Sanity check.
            // If reserved, then stockQuantity must be >= qty (unless DB is inconsistent)
            if (lockedVariant.stockQuantity < cartItem.qty) {
              // This implies physical stock is missing even though reserved.
              // Could happen if inventory check was bypassed or manual adjustment happened.
              throw new ConflictException({
                code: CartErrorCode.INSUFFICIENT_STOCK,
                message: `Inventory inconsistency for ${cartItem.title}`,
              });
            }
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
          await queryRunner.manager.decrement(BookFormatVariant, { id: variant.id }, 'stockQuantity', cartItem.qty);
          await queryRunner.manager.decrement(BookFormatVariant, { id: variant.id }, 'reservedQuantity', cartItem.qty);
        }
      }

      // 6. Update Cart Status
      cart.status = CartStatus.CHECKOUT;
      cart.checkoutStartedAt = new Date();
      await queryRunner.manager.save(Cart, cart);

      await queryRunner.commitTransaction();

      // 7. Initiate Payment (Outside DB transaction to avoid long locks)
      try {
        // Determine Provider
        // Logic: INR -> PhonePe, Others -> Razorpay
        // We can also check user preference or other rules here

        // For now, hardcoded rule:
        const currency = 'INR'; // Assuming INR for now as cart doesn't seem to have currency yet. TODO: Get from cart/user context

        let provider: IPaymentProvider;
        let providerEnum: PaymentProvider;

        if (currency === 'INR') {
          provider = this.phonePeProvider;
          providerEnum = PaymentProvider.PHONEPE;
        } else {
          provider = this.razorpayProvider;
          providerEnum = PaymentProvider.RAZORPAY;
        }

        // Create Transaction Record
        const transaction = new Transaction();
        transaction.order = savedOrder;
        transaction.amount = totalAmount;
        transaction.currency = currency;
        transaction.status = TransactionStatus.PENDING;
        transaction.provider = providerEnum;

        // Save transaction first to get ID (if needed, though UUID is generated)
        const savedTransaction = await this.transactionRepository.save(transaction);

        const paymentResponse = await provider.initiatePayment({
          orderId: savedTransaction.id, // Use Transaction UUID for uniqueness and retry support
          amount: totalAmount,
          currency: currency,
          customerPhone: dto.shippingAddress.phone,
          callbackUrl: `${process.env.APP_URL}/cart/webhook/payment`, // Backend Webhook
          redirectUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/return?orderId=${savedOrder.id}`, // Frontend Return Page
          metadata: { userId, cartId: cart.id, transactionId: savedTransaction.id },
        });

        // Update transaction with gateway ref id and raw request/response if available
        // The provider might return transactionId which is the gateway's ID
        savedTransaction.gateway_ref_id = paymentResponse.transactionId;
        savedTransaction.raw_response = paymentResponse;
        await this.transactionRepository.save(savedTransaction);

        this.metricsService.incrementCheckoutRequest('success');
        this.metricsService.observeCheckoutDuration((Date.now() - startTime) / 1000);
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
      this.metricsService.incrementCheckoutRequest('failed');
      this.logger.error('Checkout failed', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
