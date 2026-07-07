import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import {
  FulfillmentStatus,
  PaymentStatus,
} from '@app/contract/orders/enums/order-status.enum';
import { OrderQueryDto } from '@app/contract/orders/dtos/order-query.dto';
import {
  OrderAddressResponseDto,
  OrderDisplayStatus,
  OrderResponseDto,
} from '@app/contract/orders/dtos/order-response.dto';
import { PaginatedOrdersResponseDto } from '@app/contract/orders/dtos/paginated-orders-response.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  /** Relations needed to render an order: items -> variant -> book. */
  private static readonly ORDER_RELATIONS = [
    'items',
    'items.bookFormatVariant',
    'items.bookFormatVariant.book',
  ];

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  /**
   * List the authenticated user's orders, newest first.
   *
   * Returns a `{ data, meta }` envelope (matching the transactions controller
   * and the storefront's books-search `SearchMeta` shape). The frontend is
   * being aligned separately to consume this envelope. Meta is computed from
   * the applied page/limit and the total row count.
   */
  async findAllForUser(
    userId: number,
    query: OrderQueryDto,
  ): Promise<PaginatedOrdersResponseDto> {
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
  async findOneForUser(
    userId: number,
    orderId: number,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId, user: { id: userId } },
      relations: OrdersService.ORDER_RELATIONS,
    });

    if (!order) {
      this.logger.warn(
        `Order ${orderId} not found for user ${userId} (missing or not owned)`,
      );
      throw new NotFoundException('Order not found');
    }

    return this.mapToResponse(order);
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
      items: (order.items ?? []).map((item) => this.mapItem(item)),
      shippingAddress: this.mapAddress(order.shipping_address),
    };
  }

  private mapItem(item: OrderItem): OrderResponseDto['items'][number] {
    const variant = item.bookFormatVariant;
    const book = variant?.book;

    return {
      id: String(item.id),
      bookTitle: book?.title ?? '',
      bookCover: book?.coverImageUrl ?? '',
      format: variant?.format ?? '',
      quantity: Number(item.quantity),
      price: Math.round(Number(item.unit_price) * 100),
    };
  }

  /**
   * Collapse the order's two-axis state (payment_status + fulfillment_status)
   * into the single display status the storefront expects.
   *
   * Rules:
   *  - If payment hasn't succeeded yet, the order is 'PENDING' (awaiting
   *    payment) regardless of fulfillment.
   *  - REFUNDED/FAILED payments also surface as 'PENDING' for now (the FE has
   *    no dedicated state for them; cancellation is a later task).
   *  - Once PAID, the fulfillment status drives the label, with NOT_STARTED
   *    shown as 'PROCESSING' (the order is accepted and being prepared).
   */
  private mapStatus(order: Order): OrderDisplayStatus {
    if (order.payment_status !== PaymentStatus.PAID) {
      return 'PENDING';
    }

    switch (order.fulfillment_status) {
      case FulfillmentStatus.SHIPPED:
        return 'SHIPPED';
      case FulfillmentStatus.DELIVERED:
        return 'DELIVERED';
      case FulfillmentStatus.CANCELLED:
        return 'CANCELLED';
      case FulfillmentStatus.NOT_STARTED:
      case FulfillmentStatus.PROCESSING:
      default:
        return 'PROCESSING';
    }
  }

  /**
   * Map the stored shipping-address snapshot (AddressDto shape: line1, line2,
   * city, state, pincode, phone) to the storefront SavedAddress shape.
   * Fields not captured at checkout (id, country, isDefault) are defaulted.
   */
  private mapAddress(
    snapshot: Record<string, any> | null | undefined,
  ): OrderAddressResponseDto | null {
    if (!snapshot) {
      return null;
    }

    return {
      id: snapshot.id ?? '',
      line1: snapshot.line1 ?? '',
      line2: snapshot.line2 ?? undefined,
      city: snapshot.city ?? '',
      state: snapshot.state ?? '',
      postalCode: snapshot.postalCode ?? snapshot.pincode ?? '',
      country: snapshot.country ?? 'IN',
      phone: snapshot.phone ?? '',
      isDefault: snapshot.isDefault ?? false,
    };
  }
}
