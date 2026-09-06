import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { toShippingAddressSnapshot } from '@app/contract/carts/utils/shipping-address-snapshot.util';
import { IPaymentProvider, PaymentInitiationResponse, PaymentProvider } from '../interfaces/payment-provider.interface';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { CartErrorCode } from '@app/contract/carts/enums/cart-error-code.enum';
import { CartMetricsService } from '../metrics/cart-metrics.service';
import { RazorpayProvider } from './razorpay.provider';
import { ShippingRateService } from './shipping-rate.service';
import { TaxService } from './tax.service';
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
    private readonly razorpayProvider: RazorpayProvider,
    private readonly metricsService: CartMetricsService,
    private readonly shippingRateService: ShippingRateService,
    private readonly taxService: TaxService,
  ) {}

  async checkout(userId: number, dto: CheckoutDto, idempotencyKey?: string): Promise<PaymentInitiationResponse> {
    const startTime = Date.now();
    this.metricsService.incrementCheckoutRequest('pending');
    this.logger.log(`Initiating checkout for user ${userId}`);

    // Idempotency Check
    if (idempotencyKey) {
      const existingTxn = await this.transactionRepository.findOne({ where: { idempotency_key: idempotencyKey } });
      if (existingTxn) {
        this.logger.log(`Idempotency hit for key ${idempotencyKey}`);
        if (existingTxn.raw_response) {
          return existingTxn.raw_response as PaymentInitiationResponse;
        }
        // If no raw_response, transaction might be stuck in PENDING or failed.
        // We could return pending status or let it proceed if we want to double-check (but unique constraint will block double-insert).
        // ideally we return the existing state.
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Find Cart (Locking handled by optimistic locking or explicit lock if needed)
      // For checkout, we want to ensure no one else modifies the cart
      // FIX: Lock ONLY the cart row first to avoid "FOR UPDATE cannot be applied to the nullable side of an outer join"
      await queryRunner.manager.findOne(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
      });

      // Now fetch with relations (lock is already held by transaction on the cart row)
      let cart = await queryRunner.manager.findOne(Cart, {
        where: { userId, status: CartStatus.ACTIVE },
        relations: ['items', 'items.bookFormatVariant'],
      });

      if (!cart || cart.items.length === 0) {
        // Cart not found as ACTIVE — check if it's stuck in CHECKOUT (from a failed previous attempt)
        const checkoutStuckCart = await queryRunner.manager.findOne(Cart, {
          where: { userId, status: CartStatus.CHECKOUT },
          relations: ['items', 'items.bookFormatVariant'],
        });

        if (checkoutStuckCart && checkoutStuckCart.items.length > 0) {
          this.logger.log(`Recovering stuck CHECKOUT cart ${checkoutStuckCart.id} for user ${userId}`);
          checkoutStuckCart.status = CartStatus.ACTIVE;
          await queryRunner.manager.save(Cart, checkoutStuckCart);
          cart = checkoutStuckCart;
        } else {
          throw new NotFoundException({
            code: CartErrorCode.CART_NOT_FOUND,
            message: 'Active cart not found',
          });
        }
      }

      if (cart.items.length === 0) {
        throw new ConflictException({
          code: CartErrorCode.CART_EMPTY,
          message: 'Cart is empty',
        });
      }

      // 2. Validate Stock and Calculate Total
      let totalAmount = 0;
      // Inclusive tax accumulated from the locked variant rows; a slice of
      // `totalAmount`, not an addition to it.
      let taxAmount = 0;
      const orderItems: OrderItem[] = [];
      /**
       * Whether this basket needs shipping, decided from the variant rows we
       * have just locked rather than from the (possibly stale, possibly
       * unhydrated) cart relation — the amount we are about to charge must be
       * derived from the same rows the stock decision was made on.
       */
      let hasPhysicalItems = false;

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
          hasPhysicalItems = true;

          // JIT Validation & Re-reservation
          if (!cartItem.isStockReserved) {
            // Item is in cart but reservation expired. Check if we can re-reserve.
            const availableStock = Number(lockedVariant.stockQuantity) - Number(lockedVariant.reservedQuantity);
            const requestedQty = Number(cartItem.qty);

            if (availableStock < requestedQty) {
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
            this.logger.log(
              `Before Increment: Stock=${lockedVariant.stockQuantity}, Reserved=${lockedVariant.reservedQuantity}`,
            );
            await queryRunner.manager.increment(
              BookFormatVariant,
              { id: variant.id },
              'reservedQuantity',
              cartItem.qty,
            );
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

        // Tax is INCLUSIVE: this records how much of the price the customer is
        // already paying is tax. It is NOT added to `totalAmount` above — doing
        // so would double-charge. The rate is read from the LOCKED variant row
        // (not the cart snapshot) so it is the rate in force at the moment of
        // sale, and it is snapshotted onto the line so a later admin edit
        // cannot rewrite what this invoice says.
        const lineTaxPercentage = lockedVariant.includeTax ? (lockedVariant.taxPercentage ?? null) : null;
        orderItem.tax_percentage = lineTaxPercentage;
        orderItem.tax_amount = this.taxService.lineTax({
          unitPrice: Number(cartItem.unitPrice),
          quantity: cartItem.qty,
          includeTax: lockedVariant.includeTax,
          taxPercentage: lockedVariant.taxPercentage,
        });
        taxAmount += orderItem.tax_amount;

        orderItems.push(orderItem);
      }

      // 2a. A physical line needs somewhere to be sent. `CheckoutDto.shippingAddress`
      // is optional at the DTO layer — a digital-only order needs none — so
      // this is the one place that can actually tell whether an address is
      // required, because `hasPhysicalItems` above was just derived from the
      // same locked variant rows the stock and shipping-cost decisions use.
      // Without this, a paperback could reach PAID with `shipping_address`
      // permanently NULL: nothing downstream (the order entity, the admin
      // fulfilment endpoint) revalidates it, so the parcel would have no
      // address to ship to.
      if (hasPhysicalItems && !dto.shippingAddress) {
        throw new BadRequestException({
          code: CartErrorCode.SHIPPING_ADDRESS_REQUIRED,
          message: 'A shipping address is required to check out a cart containing a physical item.',
        });
      }

      // 2b. Flat-rate shipping. Charged once per order that contains anything
      // shippable, nothing for a digital-only basket. `shippingCost` is stored
      // on the order for the breakdown and is ALSO folded into `orderTotal` —
      // which is what the order, the transaction row and the Razorpay charge
      // are all built from below, so the three can never disagree.
      const shippingCost = this.shippingRateService.resolveShippingCost(hasPhysicalItems);
      const orderTotal = totalAmount + shippingCost;

      // 3. Create Order
      const order = new Order();
      order.user = { id: userId } as any;
      order.total_amount = orderTotal;
      order.shipping_cost = shippingCost;
      // A component of `total_amount`, never added to it. Summed from the
      // already-rounded per-line figures so the itemised lines add up to this.
      order.tax_amount = Math.round((taxAmount + Number.EPSILON) * 100) / 100;
      order.payment_status = PaymentStatus.PENDING;
      // Snapshot the shipping address and currency at checkout time so the order
      // record stays accurate even if the user later edits/deletes the address.
      // Normalised first so the snapshot always uses the canonical field names
      // (`postalCode`, `country`) regardless of which alias the client sent.
      order.shipping_address = dto.shippingAddress ? toShippingAddressSnapshot(dto.shippingAddress) : null;
      // Currency is currently INR-only (Razorpay). Centralised here so the order
      // carries the value the payment is initiated with.
      order.currency = 'INR';

      const savedOrder = await queryRunner.manager.save(Order, order);

      // 4. Save Order Items
      for (const item of orderItems) {
        item.order = savedOrder;
        await queryRunner.manager.save(OrderItem, item);
      }

      // 5. Update Stock
      // KEEP reservation held until Payment Success/Failure
      // Do NOT decrement reservedQuantity here.

      // 6. Update Cart Status
      cart.status = CartStatus.CHECKOUT;
      cart.checkoutStartedAt = new Date();
      await queryRunner.manager.save(Cart, cart);

      await queryRunner.commitTransaction();

      // 7. Initiate Payment (Outside DB transaction to avoid long locks)
      try {
        // Razorpay is the only gateway we accept (roadmap #6). `CheckoutDto`
        // validates `paymentMethod` against the same enum, so anything else is
        // already a 400 before we get here — this check only guards against a
        // caller bypassing the DTO.
        const providerName = dto.paymentMethod;
        if (providerName !== PaymentProvider.RAZORPAY) {
          throw new ConflictException('Invalid payment provider');
        }

        const provider: IPaymentProvider = this.razorpayProvider;
        const currency = 'INR';

        // Create Transaction Record
        const transaction = new Transaction();
        transaction.order = savedOrder;
        // Shipping-inclusive, matching `order.total_amount`. Charging the
        // line-item subtotal here would leave the gateway collecting less than
        // the order says it is worth.
        transaction.amount = orderTotal;
        transaction.currency = currency;
        transaction.status = TransactionStatus.PENDING;
        transaction.provider = providerName;
        if (idempotencyKey) {
          transaction.idempotency_key = idempotencyKey;
        }

        // Save transaction first to get ID (if needed, though UUID is generated)
        let savedTransaction: Transaction;

        try {
          savedTransaction = await this.transactionRepository.save(transaction);
        } catch (error) {
          if (error.code === '23505') {
            // Unique constraint violation (Postgres)
            this.logger.log(`Idempotency hit during save for key ${idempotencyKey}`);
            // Find the existing transaction and reuse it
            const existingTxn = await this.transactionRepository.findOne({
              where: { idempotency_key: idempotencyKey },
            });

            if (existingTxn) {
              this.logger.log(`Reusing transaction ${existingTxn.id} for idempotency key ${idempotencyKey}`);
              savedTransaction = existingTxn;

              // If it already has a raw response (like Razorpay order), just return it
              if (existingTxn.raw_response) {
                return existingTxn.raw_response as PaymentInitiationResponse;
              }
            } else {
              throw new ConflictException('Concurrent duplicate request detected');
            }
          } else {
            throw error;
          }
        }

        const paymentResponse = await provider.initiatePayment({
          orderId: savedTransaction.id, // Use Transaction UUID for uniqueness and retry support
          amount: orderTotal,
          currency: currency,
          customerPhone: dto.shippingAddress?.phone || '',
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
        // Since DB transaction was already committed at line 209, we don't rollback here.
        this.logger.error(`Payment initiation failed for order ${savedOrder.id}`, error);
        throw error; // Rethrow to let the controller return 500/409
      }
    } catch (error) {
      // Only rollback if the transaction hasn't been committed yet
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
        this.logger.error('Checkout failed - rolled back DB transaction', error);
      }

      this.metricsService.incrementCheckoutRequest('failed');

      // Handle the specific Postgres duplicate error gracefully if it leaks out
      if (error.code === '23505') {
        throw new ConflictException('Duplicate payment request detected. Please refresh the page and try again.');
      }

      throw error;
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }
}
