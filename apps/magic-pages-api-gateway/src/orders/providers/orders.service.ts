import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, Repository } from 'typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';
import { OrderErrorCode } from '@app/contract/orders/enums/order-error-code.enum';
import { DEFAULT_SHIPPING_COUNTRY } from '@app/contract/carts/utils/shipping-address-snapshot.util';
import { FulfillmentStatus, PaymentStatus } from '@app/contract/orders/enums/order-status.enum';

import { PaymentStatus as PaymentStatusInterface } from '../../cart/interfaces/payment-provider.interface';
import { OrderQueryDto } from '@app/contract/orders/dtos/order-query.dto';
import {
  DigitalDeliveryDisplayStatus,
  OrderAddressResponseDto,
  OrderDisplayStatus,
  OrderResponseDto,
} from '@app/contract/orders/dtos/order-response.dto';
import { DigitalDeliveryStatus } from '@app/contract/orders/enums/digital-delivery-status.enum';
import { PaginatedOrdersResponseDto } from '@app/contract/orders/dtos/paginated-orders-response.dto';
import {
  VerifiedOrderSummaryDto,
  VerifyOrderResponseDto,
} from '@app/contract/orders/dtos/verify-order-response.dto';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { OrderAdminQueryDto } from '@app/contract/orders/dtos/order-admin-query.dto';
import { UpdateOrderFulfillmentDto } from '@app/contract/orders/dtos/update-order-fulfillment.dto';
import {
  AdminOrderResponseDto,
  PaginatedAdminOrdersResponseDto,
} from '@app/contract/orders/dtos/admin-order-response.dto';
import { RazorpayProvider } from '../../cart/providers/razorpay.provider';
import { PaymentSettlementService } from '../../cart/services/payment-settlement.service';
import { PhysicalFulfillmentService } from '../../physical-fulfillment/providers/physical-fulfillment.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  /** Relations needed to render an order: items -> variant -> book. */
  private static readonly ORDER_RELATIONS = ['items', 'items.bookFormatVariant', 'items.bookFormatVariant.book'];

  /**
   * The physical fulfilment state machine, as an adjacency list of what an
   * admin may move an order TO from each state.
   *
   * Read it as a one-way ratchet: work only ever moves forward, and every
   * forward step is either "we are preparing it", "it left the building" or
   * "the customer has it".
   *
   *  - `NOT_STARTED` can jump straight to SHIPPED. A small shop often packs and
   *    dispatches in one action, and forcing a pointless PROCESSING click first
   *    would only train admins to double-click.
   *  - Nothing may target `NOT_STARTED` or `PROCESSING` from a later state:
   *    un-shipping a parcel is not a thing, and the customer has already been
   *    e-mailed about it.
   *  - Nothing may target `CANCELLED`. Customer cancellation is
   *    `POST /user/orders/:id/cancel` (unpaid orders only) and an admin
   *    cancel/refund of a paid order is separate, unbuilt scope — silently
   *    allowing it here would cancel an order while keeping the money.
   *  - `DELIVERED` and `CANCELLED` are terminal, hence empty lists.
   *
   * Staying put (`X -> X`) is not in this map on purpose: that case is caught
   * earlier as an idempotent no-op, so a double-clicked button neither errors
   * nor sends a second e-mail.
   */
  private static readonly ALLOWED_FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
    [FulfillmentStatus.NOT_STARTED]: [FulfillmentStatus.PROCESSING, FulfillmentStatus.SHIPPED],
    [FulfillmentStatus.PROCESSING]: [FulfillmentStatus.SHIPPED],
    [FulfillmentStatus.SHIPPED]: [FulfillmentStatus.DELIVERED],
    [FulfillmentStatus.DELIVERED]: [],
    [FulfillmentStatus.CANCELLED]: [],
  };

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,

    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,

    private readonly dataSource: DataSource,

    private readonly razorpayProvider: RazorpayProvider,

    /**
     * Shared settlement path (lock-protected + idempotent). `verifyOrder` is a
     * third way a payment result can reach us, alongside the webhook and the
     * reconciliation cron — all three must write identical state.
     */
    private readonly settlementService: PaymentSettlementService,

    /**
     * Sends the shipped/delivered e-mails after `updateFulfillmentAdmin`
     * commits. Owned by the physical-fulfilment module rather than inlined here
     * so all three customer-facing physical e-mails (confirmation, shipped,
     * delivered) share one never-throws contract and one order-URL builder.
     */
    private readonly physicalFulfillmentService: PhysicalFulfillmentService,
  ) {}

  /**
   * List the authenticated user's orders, newest first.
   *
   * Returns a `{ data, meta }` envelope (matching the transactions controller
   * and the storefront's books-search `SearchMeta` shape). The frontend is
   * being aligned separately to consume this envelope. Meta is computed from
   * the applied page/limit and the total row count.
   */
  async findAllForUser(userId: number, query: OrderQueryDto): Promise<PaginatedOrdersResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.bookFormatVariant', 'bookFormatVariant')
      .leftJoinAndSelect('bookFormatVariant.book', 'book')
      .where('order.user = :userId', { userId })
      .orderBy('order.created_at', 'DESC')
      .skip(skip)
      .take(limit);

    // Run data + count in parallel for efficiency.
    const [orders, total] = await Promise.all([qb.getMany(), qb.getCount()]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: orders.map((order) => this.mapToResponse(order)),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Fetch a single order owned by the authenticated user.
   * Throws 404 if the order does not exist OR belongs to another user
   * (we do not distinguish, to avoid leaking existence of others' orders).
   */
  async findOneForUser(userId: number, orderId: number): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId, user: { id: userId } },
      relations: OrdersService.ORDER_RELATIONS,
    });

    if (!order) {
      this.logger.warn(`Order ${orderId} not found for user ${userId} (missing or not owned)`);
      throw new NotFoundException('Order not found');
    }

    return this.mapToResponse(order);
  }

  /**
   * Cancel an order on behalf of its owner.
   *
   * Cancellation is only offered before the order is paid for — the storefront
   * shows the button only while the order displays as `PENDING`, and this
   * method enforces the same rule server-side. A paid order needs a refund,
   * which is a separate (not yet built) flow.
   *
   * The whole thing runs in one transaction with a pessimistic write lock on
   * the order row, following `CheckoutService`:
   *
   *  1. Lock the order row, then verify ownership (404 for both "missing" and
   *     "someone else's" so we never leak the existence of another user's order).
   *  2. Refuse anything past the pre-fulfillment window (409 + typed code).
   *  3. Release the stock reservation the checkout is still holding, clamped
   *     at zero so a racing webhook can never drive `reservedQuantity` negative
   *     (a negative reservation reads as extra availability => oversell).
   *  4. Fail any still-PENDING transactions and move the order to
   *     FAILED / CANCELLED. Marking payment FAILED also takes the order out of
   *     `OrderTimeoutService`'s query, so the cron cannot release the same
   *     reservation a second time.
   *  5. Keep the cart consistent: an unpaid order leaves the cart parked in
   *     CHECKOUT with `isStockReserved` set, which would double-count on the
   *     next checkout now that we have released the hold.
   *
   * Idempotent: cancelling an already-cancelled order returns the order
   * unchanged rather than erroring, so a double-clicked button is harmless.
   */
  async cancelOrder(userId: number, orderId: number): Promise<OrderResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1a. Lock by primary key only. Locking with a relation filter makes
      // TypeORM emit a LEFT JOIN, which Postgres refuses to lock ("FOR UPDATE
      // cannot be applied to the nullable side of an outer join") — the same
      // two-step dance CheckoutService does for the cart row.
      const lockedOrder = await queryRunner.manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedOrder) {
        throw new NotFoundException({ code: OrderErrorCode.ORDER_NOT_FOUND, message: 'Order not found' });
      }

      // 1b. Re-read with relations now that the row is held.
      const order = await queryRunner.manager.findOne(Order, {
        where: { id: orderId },
        relations: [...OrdersService.ORDER_RELATIONS, 'user', 'transactions'],
      });

      if (!order || order.user?.id !== userId) {
        this.logger.warn(`Cancel refused: order ${orderId} not owned by user ${userId}`);
        throw new NotFoundException({ code: OrderErrorCode.ORDER_NOT_FOUND, message: 'Order not found' });
      }

      // 2. Already cancelled -> no-op, return current state (idempotent).
      if (order.fulfillment_status === FulfillmentStatus.CANCELLED) {
        await queryRunner.commitTransaction();
        return this.mapToResponse(order);
      }

      const hasSuccessfulPayment =
        order.payment_status === PaymentStatus.PAID ||
        (order.transactions ?? []).some((txn) => txn.status === TransactionStatus.SUCCESS);

      if (hasSuccessfulPayment) {
        throw new ConflictException({
          code: OrderErrorCode.ORDER_ALREADY_PAID,
          message: 'This order has already been paid for and cannot be cancelled. Please request a refund.',
        });
      }

      if (
        order.payment_status === PaymentStatus.REFUNDED ||
        order.fulfillment_status === FulfillmentStatus.SHIPPED ||
        order.fulfillment_status === FulfillmentStatus.DELIVERED
      ) {
        throw new ConflictException({
          code: OrderErrorCode.ORDER_NOT_CANCELLABLE,
          message: 'This order can no longer be cancelled.',
        });
      }

      // 3. Release the stock reservation. Only a PENDING order still holds one:
      // FAILED orders were already released by the timeout cron / webhook.
      const releasedVariantIds = new Set<number>();

      if (order.payment_status === PaymentStatus.PENDING) {
        for (const item of order.items ?? []) {
          const variantId = item.bookFormatVariant?.id;
          if (!variantId) {
            continue;
          }

          // Lock the variant before reading-then-writing its counters.
          const variant = await queryRunner.manager.findOne(BookFormatVariant, {
            where: { id: variantId },
            lock: { mode: 'pessimistic_write' },
          });

          if (!variant || !isPhysicalFormat(variant.format)) {
            continue;
          }

          // Clamp at zero: never let a reservation go negative.
          variant.reservedQuantity = Math.max(0, Number(variant.reservedQuantity) - Number(item.quantity));
          await queryRunner.manager.save(BookFormatVariant, variant);
          releasedVariantIds.add(variantId);
        }
      }

      // 4. Fail outstanding transactions, then move the order to cancelled.
      for (const txn of order.transactions ?? []) {
        if (txn.status === TransactionStatus.PENDING) {
          txn.status = TransactionStatus.FAILED;
          await queryRunner.manager.save(Transaction, txn);
        }
      }

      order.fulfillment_status = FulfillmentStatus.CANCELLED;
      if (order.payment_status === PaymentStatus.PENDING) {
        order.payment_status = PaymentStatus.FAILED;
      }
      await queryRunner.manager.save(Order, order);

      const statusLog = new OrderStatusLog();
      statusLog.order = order;
      statusLog.payment_status = order.payment_status;
      statusLog.fulfillment_status = order.fulfillment_status;
      statusLog.changed_by = { id: userId } as any;
      statusLog.comment = 'Cancelled by customer';
      await queryRunner.manager.save(OrderStatusLog, statusLog);

      // 5. Un-park the cart so the released reservation is not double-counted.
      if (releasedVariantIds.size > 0) {
        await this.releaseCheckoutCart(queryRunner.manager, userId, releasedVariantIds);
      }

      await queryRunner.commitTransaction();
      this.logger.log(`Order ${orderId} cancelled by user ${userId}`);

      return this.mapToResponse(order);
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }

  /**
   * List every order in the shop for the admin fulfilment queue.
   *
   * Deliberately has no ownership filter — that is the whole difference from
   * `findAllForUser`, and the reason this method is only reachable from a
   * controller carrying `@Role(RoleTypes.ADMIN)`. It takes no user id at all,
   * so there is no parameter an attacker could aim at someone else's data and
   * no way to call it "as" another customer.
   */
  async findAllForAdmin(query: OrderAdminQueryDto): Promise<PaginatedAdminOrdersResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.bookFormatVariant', 'bookFormatVariant')
      .leftJoinAndSelect('bookFormatVariant.book', 'book')
      .orderBy('order.created_at', 'DESC')
      .skip(skip)
      .take(limit);

    if (query.fulfillmentStatus) {
      qb.andWhere('order.fulfillment_status = :fulfillmentStatus', { fulfillmentStatus: query.fulfillmentStatus });
    }

    if (query.paymentStatus) {
      qb.andWhere('order.payment_status = :paymentStatus', { paymentStatus: query.paymentStatus });
    }

    if (query.search) {
      const search = query.search;
      const orderId = parseOrderNumber(search);

      // Bracketed so the OR cannot escape and widen the status filters above.
      qb.andWhere(
        new Brackets((where) => {
          where.where('user.email ILIKE :emailSearch', { emailSearch: `%${search}%` });
          if (orderId !== null) {
            where.orWhere('order.id = :orderId', { orderId });
          }
        }),
      );
    }

    const [orders, total] = await Promise.all([qb.getMany(), qb.getCount()]);
    const totalPages = Math.ceil(total / limit);

    return {
      data: orders.map((order) => this.mapToAdminResponse(order)),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Fetch one order for the admin panel. No ownership check by design — an
   * admin works other people's orders — so the only 404 is a genuinely missing
   * row.
   */
  async findOneForAdmin(orderId: number): Promise<AdminOrderResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: [...OrdersService.ORDER_RELATIONS, 'user'],
    });

    if (!order) {
      throw new NotFoundException({ code: OrderErrorCode.ORDER_NOT_FOUND, message: 'Order not found' });
    }

    return this.mapToAdminResponse(order);
  }

  /**
   * Advance an order's physical fulfilment state on behalf of an admin.
   *
   * This is the missing half of the order lifecycle: digital lines have been
   * claimed-and-delivered by `DigitalDeliveryService` since settlement, but a
   * printed book had no way to move past `PROCESSING`, no place to record a
   * carrier or an AWB, and sent the buyer nothing between paying and (nothing).
   *
   * Structured exactly like `cancelOrder`, because it has the same hazards —
   * concurrent writers on one order row, and a side effect (an e-mail) that
   * cannot be rolled back:
   *
   *  1. Lock the order row by PK, then re-read it with relations. Locking with
   *     a relation filter makes TypeORM emit a LEFT JOIN, which Postgres
   *     refuses to lock.
   *  2. Refuse a CANCELLED order outright: a cancelled order never ships, and
   *     letting it would contradict the refund that is owed on it.
   *  3. Refuse an unpaid order (409 `FULFILLMENT_NOT_PAID`). Nothing leaves the
   *     building before the money is in.
   *  4. No-op when the requested state is the state we are already in, so a
   *     double-clicked "Mark shipped" is harmless rather than a second e-mail.
   *  5. Refuse an order with no physical line (409
   *     `FULFILLMENT_NO_PHYSICAL_ITEMS`). A digital-only order is fully served
   *     by `DigitalDeliveryService` at settlement time and never leaves
   *     `NOT_STARTED` — that is by design (see `PhysicalFulfillmentService
   *     .markProcessing`), not an unclaimed physical order, so this endpoint
   *     must not "ship" or "deliver" an e-book.
   *  6. Check the transition against `ALLOWED_FULFILLMENT_TRANSITIONS`, and
   *     require carrier + tracking number when the target is SHIPPED.
   *  7. Write the new state, the tracking fields and the first-transition
   *     timestamp, plus an `OrderStatusLog` row attributing the change to the
   *     admin who made it.
   *  8. **After commit**, dispatch the shipped/delivered e-mail best-effort.
   *
   * @param adminUserId the authenticated admin, taken from the bearer token by
   *        `@CurrentUser()` — never from the request body — and recorded as the
   *        audit row's `changed_by`
   */
  async updateFulfillmentAdmin(
    adminUserId: number,
    orderId: number,
    dto: UpdateOrderFulfillmentDto,
  ): Promise<AdminOrderResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    /**
     * Set only when this call actually performed a transition, and read after
     * the commit to decide which e-mail (if any) the customer is owed. Left
     * null by the idempotent no-op path, which is what stops a re-click from
     * mailing twice.
     */
    let dispatchStatus: FulfillmentStatus | null = null;

    try {
      // 1a. Lock by primary key only — same two-step dance as `cancelOrder`.
      const lockedOrder = await queryRunner.manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedOrder) {
        throw new NotFoundException({ code: OrderErrorCode.ORDER_NOT_FOUND, message: 'Order not found' });
      }

      // 1b. Re-read with relations now that the row is held.
      const order = await queryRunner.manager.findOne(Order, {
        where: { id: orderId },
        relations: [...OrdersService.ORDER_RELATIONS, 'user'],
      });

      if (!order) {
        throw new NotFoundException({ code: OrderErrorCode.ORDER_NOT_FOUND, message: 'Order not found' });
      }

      const target = dto.fulfillmentStatus;
      const current = order.fulfillment_status;

      // 2. A cancelled order is terminal. Checked before the idempotent no-op
      // so that "set a cancelled order to CANCELLED" is an explicit refusal
      // rather than a silent success that implies this endpoint can cancel.
      if (current === FulfillmentStatus.CANCELLED) {
        throw new ConflictException({
          code: OrderErrorCode.FULFILLMENT_INVALID_TRANSITION,
          message: 'This order has been cancelled and cannot be fulfilled.',
        });
      }

      // 3. Payment first, always.
      if (order.payment_status !== PaymentStatus.PAID) {
        throw new ConflictException({
          code: OrderErrorCode.FULFILLMENT_NOT_PAID,
          message: 'This order has not been paid for yet and cannot be fulfilled.',
        });
      }

      // 4. Idempotent no-op. Returns the order untouched: no save, no audit
      // row, no e-mail.
      if (target === current) {
        await queryRunner.commitTransaction();
        return this.mapToAdminResponse(order);
      }

      // 5. An order with no physical line has nothing for this endpoint to do.
      // Digital-only orders are fully served by `DigitalDeliveryService` at
      // settlement time and are deliberately left on NOT_STARTED forever (see
      // `PhysicalFulfillmentService.markProcessing`) — that NOT_STARTED does
      // NOT mean "an unclaimed physical order waiting to be packed". Without
      // this guard an admin could mark a paid e-book order SHIPPED/DELIVERED,
      // which would both send the buyer a nonsensical tracking e-mail and
      // record a carrier/AWB for a parcel that was never packed.
      const hasPhysicalLine = (order.items ?? []).some((item) => {
        const variant = item.bookFormatVariant;
        return !!variant && isPhysicalFormat(variant.format);
      });

      if (!hasPhysicalLine) {
        throw new ConflictException({
          code: OrderErrorCode.FULFILLMENT_NO_PHYSICAL_ITEMS,
          message: 'This order has no physical items to fulfil — digital lines are delivered by e-mail, not shipped.',
        });
      }

      // 6. Transition legality.
      if (!OrdersService.ALLOWED_FULFILLMENT_TRANSITIONS[current].includes(target)) {
        throw new ConflictException({
          code: OrderErrorCode.FULFILLMENT_INVALID_TRANSITION,
          message: `An order cannot move from ${current} to ${target}.`,
        });
      }

      // The DTO already enforces this (conditionally required fields), so
      // reaching here means the service was called directly. Kept anyway: this
      // is the invariant that stops a customer receiving a "your parcel has
      // shipped" e-mail with no way to find the parcel.
      if (target === FulfillmentStatus.SHIPPED && (!dto.carrier || !dto.trackingNumber)) {
        throw new BadRequestException({
          code: OrderErrorCode.FULFILLMENT_INVALID_TRANSITION,
          message: 'carrier and trackingNumber are required when marking an order as shipped.',
        });
      }

      // 7. Apply. Tracking fields are only overwritten when supplied, so an
      // admin marking an order DELIVERED does not blank the carrier they
      // entered when they shipped it.
      order.fulfillment_status = target;

      if (dto.carrier !== undefined) {
        order.carrier = dto.carrier;
      }
      if (dto.trackingNumber !== undefined) {
        order.tracking_number = dto.trackingNumber;
      }
      if (dto.trackingUrl !== undefined) {
        order.tracking_url = dto.trackingUrl;
      }

      // Stamped once. A later call must not rewrite when the parcel actually
      // left, and these timestamps are what the storefront's tracking stepper
      // renders.
      if (target === FulfillmentStatus.SHIPPED && !order.shipped_at) {
        order.shipped_at = new Date();
      }
      if (target === FulfillmentStatus.DELIVERED && !order.delivered_at) {
        order.delivered_at = new Date();
      }

      await queryRunner.manager.save(Order, order);

      const statusLog = new OrderStatusLog();
      statusLog.order = order;
      statusLog.payment_status = order.payment_status;
      statusLog.fulfillment_status = order.fulfillment_status;
      statusLog.changed_by = { id: adminUserId } as any;
      statusLog.comment = dto.comment ?? `Fulfilment moved ${current} -> ${target} by admin`;
      await queryRunner.manager.save(OrderStatusLog, statusLog);

      await queryRunner.commitTransaction();
      dispatchStatus = target;

      this.logger.log(`Order ${orderId} fulfilment ${current} -> ${target} by admin ${adminUserId}`);

      // 8. AFTER the commit, never before: an e-mail cannot be rolled back, so
      // the customer must not be told a parcel shipped until that fact is
      // durable. `dispatchShipmentUpdate` swallows its own failures — a mail
      // outage must not turn a correct state change into a 500 that tempts the
      // admin into clicking again.
      await this.physicalFulfillmentService.dispatchShipmentUpdate(orderId, dispatchStatus);

      return this.mapToAdminResponse(order);
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }

  /**
   * Return the user's parked CHECKOUT cart to ACTIVE and clear the
   * `isStockReserved` flag on exactly the items whose reservation we just
   * released, so the next checkout re-reserves them just-in-time instead of
   * assuming a hold that no longer exists.
   *
   * Only the variants in `releasedVariantIds` are touched: in the (rare) case
   * where the parked cart is not the one this order came from, leaving the
   * other items flagged is the conservative choice — they keep their real
   * reservation rather than being reserved twice.
   */
  private async releaseCheckoutCart(
    manager: EntityManager,
    userId: number,
    releasedVariantIds: Set<number>,
  ): Promise<void> {
    const cart = await manager.findOne(Cart, {
      where: { userId, status: CartStatus.CHECKOUT },
      relations: ['items'],
    });

    if (!cart) {
      return;
    }

    for (const cartItem of cart.items ?? []) {
      if (releasedVariantIds.has(cartItem.bookFormatVariantId) && cartItem.isStockReserved) {
        cartItem.isStockReserved = false;
        await manager.save(CartItem, cartItem);
      }
    }

    cart.status = CartStatus.ACTIVE;
    cart.checkoutStartedAt = undefined;
    await manager.save(Cart, cart);
  }

  /** Map an Order entity (snake_case) to the storefront DTO (camelCase). */
  private mapToResponse(order: Order): OrderResponseDto {
    return {
      id: String(order.id),
      orderNumber: `MP-${String(order.id).padStart(6, '0')}`,
      date: order.created_at?.toISOString(),
      status: this.mapStatus(order),
      total: Math.round(Number(order.total_amount) * 100),
      currency: order.currency ?? 'INR',
      items: (order.items ?? []).map((item) => this.mapItem(item, order)),
      shippingAddress: this.mapAddress(order.shipping_address),
      // Minor units, matching `total` and `items[].price` above. Already
      // included in `total` — the frontend shows it as a breakdown line.
      shippingCost: Math.round(Number(order.shipping_cost ?? 0) * 100),
      // Inclusive: a component of `total` above, never added to it.
      taxAmount: Math.round(Number(order.tax_amount ?? 0) * 100),
      carrier: order.carrier ?? null,
      trackingNumber: order.tracking_number ?? null,
      trackingUrl: order.tracking_url ?? null,
      shippedAt: toIsoString(order.shipped_at),
      deliveredAt: toIsoString(order.delivered_at),
    };
  }

  /**
   * The admin view: everything the customer sees, plus who placed the order.
   *
   * The customer object is built field by field rather than spread, so the
   * `User` entity's `passwordHash` / `googleId` / `status` can never ride along
   * into an API response.
   */
  private mapToAdminResponse(order: Order): AdminOrderResponseDto {
    const user = order.user;
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');

    return {
      ...this.mapToResponse(order),
      customer: {
        id: user?.id ?? 0,
        email: user?.email ?? '',
        name,
      },
    };
  }

  private mapItem(item: OrderItem, order: Order): OrderResponseDto['items'][number] {
    const variant = item.bookFormatVariant;
    const book = variant?.book;

    // `isDigital` is false when the variant failed to load rather than
    // defaulting to digital: offering a download link we cannot honour is worse
    // than omitting one.
    const isDigital = !!variant && !isPhysicalFormat(variant.format);
    const isPaid = order.payment_status === PaymentStatus.PAID;

    return {
      id: String(item.id),
      bookTitle: book?.title ?? '',
      bookCover: book?.coverImageUrl ?? '',
      format: variant?.format ?? '',
      quantity: Number(item.quantity),
      price: Math.round(Number(item.unit_price) * 100),
      isDigital,
      deliveryStatus: this.mapDeliveryStatus(item, isDigital),
      deliveredAt: item.digital_delivered_at ? item.digital_delivered_at.toISOString() : null,
      // Mirrors exactly what DigitalDownloadService will allow, so the frontend
      // never renders a button that is guaranteed to 403.
      downloadUrl: isDigital && isPaid ? `/user/orders/${order.id}/items/${item.id}/download` : null,
    };
  }

  /**
   * Project the stored delivery state onto what the storefront displays.
   *
   * Physical lines are `null` (the concept does not apply). For a digital line,
   * a NULL column means no delivery has been claimed yet — whether because the
   * order is unpaid or because settlement has not run — and both display as
   * `PENDING`.
   */
  private mapDeliveryStatus(item: OrderItem, isDigital: boolean): DigitalDeliveryDisplayStatus | null {
    if (!isDigital) {
      return null;
    }

    switch (item.digital_delivery_status) {
      case DigitalDeliveryStatus.DELIVERED:
        return 'DELIVERED';
      case DigitalDeliveryStatus.SENDING:
        return 'SENDING';
      case DigitalDeliveryStatus.FAILED:
        return 'FAILED';
      default:
        return 'PENDING';
    }
  }

  /**
   * Collapse the order's two-axis state (payment_status + fulfillment_status)
   * into the single display status the storefront expects.
   *
   * Rules:
   *  - A CANCELLED fulfillment status always wins. This check must come first:
   *    a customer-cancelled order is left unpaid (payment_status FAILED), so
   *    without it the order would keep reporting 'PENDING' and the storefront
   *    would show the cancel button again on an already-cancelled order.
   *  - Otherwise, if payment hasn't succeeded yet the order is 'PENDING'
   *    (awaiting payment) regardless of fulfillment.
   *  - REFUNDED/FAILED payments on a non-cancelled order also surface as
   *    'PENDING' for now (the FE has no dedicated state for them).
   *  - Once PAID, the fulfillment status drives the label, with NOT_STARTED
   *    shown as 'PROCESSING' (the order is accepted and being prepared).
   */
  private mapStatus(order: Order): OrderDisplayStatus {
    if (order.fulfillment_status === FulfillmentStatus.CANCELLED) {
      return 'CANCELLED';
    }

    if (order.payment_status !== PaymentStatus.PAID) {
      return 'PENDING';
    }

    switch (order.fulfillment_status) {
      case FulfillmentStatus.SHIPPED:
        return 'SHIPPED';
      case FulfillmentStatus.DELIVERED:
        return 'DELIVERED';
      // CANCELLED is handled by the early return above.
      case FulfillmentStatus.NOT_STARTED:
      case FulfillmentStatus.PROCESSING:
      default:
        return 'PROCESSING';
    }
  }

  /**
   * Map the stored shipping-address snapshot to the storefront SavedAddress
   * shape.
   *
   * Orders written from this commit onward store the canonical snapshot
   * (`ShippingAddressSnapshot`: line1, line2, city, state, postalCode,
   * country, phone) produced by `toShippingAddressSnapshot`, so this is
   * mostly a pass-through. The `pincode` fallback is retained for rows
   * written before that normalisation existed and can be dropped once those
   * are backfilled or aged out. `id`/`isDefault` are not captured at checkout
   * and are defaulted.
   */
  private mapAddress(snapshot: Record<string, any> | null | undefined): OrderAddressResponseDto | null {
    if (!snapshot) {
      return null;
    }

    return {
      id: snapshot.id ?? '',
      line1: snapshot.line1 ?? '',
      line2: snapshot.line2 ?? undefined,
      city: snapshot.city ?? '',
      state: snapshot.state ?? '',
      // Legacy rows used `pincode`; canonical rows use `postalCode`.
      postalCode: snapshot.postalCode ?? snapshot.pincode ?? '',
      country: snapshot.country ?? DEFAULT_SHIPPING_COUNTRY,
      phone: snapshot.phone ?? '',
      isDefault: snapshot.isDefault ?? false,
    };
  }

  /**
   * Resolve a Razorpay order reference back to our payment state.
   *
   * The storefront calls this from the success/return page after the Razorpay
   * modal closes, and polls it while the answer is PENDING. The webhook is
   * still the primary settlement signal — this endpoint exists because the
   * customer lands back on our page before (or instead of) the webhook
   * arriving, and we would otherwise show them "pending" on a paid order.
   *
   * Three cases:
   *  1. The transaction is already terminal (SUCCESS/FAILED) — report it. This
   *     is the common path once the webhook has landed.
   *  2. Still PENDING locally — ask Razorpay directly, by the same
   *     `razorpay_order_id` the reconciliation cron polls.
   *  3. Razorpay says paid — settle through `PaymentSettlementService`, the
   *     same lock-protected, idempotent path the webhook and the reconciliation
   *     cron use. This method used to hand-roll the update (transaction ->
   *     SUCCESS and a no-op `save(undefined)`), which meant a payment first
   *     observed here left the order unpaid, the stock never permanently
   *     deducted and the cart parked in CHECKOUT. Racing with a webhook for the
   *     same payment is safe: whoever takes the order lock second sees SUCCESS
   *     and does nothing.
   *
   * Ownership is enforced in the query (`order.user.id`), and a miss is a plain
   * 404 either way so we never reveal that someone else's reference exists.
   */
  public async verifyOrder(userId: number, gatewayOrderId: string): Promise<VerifyOrderResponseDto> {
    // `relations` is load-bearing: the `where` clause filters through
    // `order.user`, but TypeORM only hydrates what `relations` asks for. Without
    // it `txn.order` came back undefined, so the response carried no order at
    // all and the settlement branch below had nothing to work with.
    const txn = await this.transactionRepository.findOne({
      where: {
        gateway_ref_id: gatewayOrderId,
        order: { user: { id: userId } },
      },
      relations: { order: true },
    });

    if (!txn) {
      // Deliberately terse: the reference and the user id stay out of the
      // client-facing message.
      this.logger.warn(`Verify miss: gateway ref ${gatewayOrderId} not found for user ${userId}`);
      throw new NotFoundException({ code: OrderErrorCode.ORDER_NOT_FOUND, message: 'Order not found' });
    }

    if (txn.status === TransactionStatus.SUCCESS || txn.status === TransactionStatus.FAILED) {
      return { status: txn.status, order: this.mapVerifiedOrder(txn.order) };
    }

    if (!txn.gateway_ref_id) {
      // Never reached the gateway, so there is nothing to poll.
      return { status: TransactionStatus.PENDING, order: this.mapVerifiedOrder(txn.order) };
    }

    const live = await this.razorpayProvider.getPaymentStatus(txn.gateway_ref_id);

    if (live.status === PaymentStatusInterface.SUCCESS) {
      await this.settlementService.settleSuccess(txn.id, { verify: live });
      // Re-read: settlement ran in its own transaction, so the copy we hold is
      // stale (payment_status would still read PENDING).
      const settled = await this.orderRepository.findOne({ where: { id: txn.order?.id } });
      return { status: TransactionStatus.SUCCESS, order: this.mapVerifiedOrder(settled ?? txn.order) };
    }

    if (live.status === PaymentStatusInterface.FAILED) {
      await this.settlementService.settleFailure(txn.id, { verify: live });
      const settled = await this.orderRepository.findOne({ where: { id: txn.order?.id } });
      return { status: TransactionStatus.FAILED, order: this.mapVerifiedOrder(settled ?? txn.order) };
    }

    // Razorpay reports `created` / `attempted`: the customer has not paid yet.
    // The storefront keeps polling; OrderTimeoutService cancels at 15 minutes.
    return { status: TransactionStatus.PENDING, order: this.mapVerifiedOrder(txn.order) };
  }

  /**
   * Project an Order entity onto the small snake_case summary the storefront's
   * success page reads. Explicit field list so the `user` relation (or any
   * field added to `Order` later) can never leak into this response.
   */
  private mapVerifiedOrder(order: Order | null | undefined): VerifiedOrderSummaryDto | null {
    if (!order) {
      return null;
    }

    return {
      id: order.id,
      total_amount: Number(order.total_amount),
      currency: order.currency,
      payment_status: order.payment_status,
      fulfillment_status: order.fulfillment_status,
      created_at: order.created_at,
    };
  }
}

/**
 * Serialise a nullable timestamp column to ISO 8601.
 *
 * Handles a raw string as well as a `Date`: TypeORM normally hydrates
 * timestamptz into a `Date`, but a value coming back through a raw query or a
 * test double can be a string, and calling `.toISOString()` on that throws
 * inside a response mapper — the worst possible place to fail.
 */
function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Recover an order id from whatever an admin typed into the search box.
 *
 * `MP-000042`, `mp42` and `42` all resolve to 42; an e-mail or any other text
 * resolves to null and the caller falls back to an e-mail match alone. Returns
 * null rather than NaN so the caller never puts a NaN into a SQL parameter.
 */
function parseOrderNumber(search: string): number | null {
  const digits = search.replace(/^mp[-\s]?/i, '').trim();

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  const parsed = Number.parseInt(digits, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
