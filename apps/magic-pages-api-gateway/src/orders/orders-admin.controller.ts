import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { CurrentUser } from 'libs/common/src/decorators/current-user.decorator';
import { UserData } from 'libs/common/src/types/user-data.type';

import { Auth } from '../auth/decorator/auth.decorator';
import { Role } from '../auth/decorator/role.decorator';
import { OrdersService } from './providers/orders.service';

import { OrderAdminQueryDto } from '@app/contract/orders/dtos/order-admin-query.dto';
import { UpdateOrderFulfillmentDto } from '@app/contract/orders/dtos/update-order-fulfillment.dto';
import {
  AdminOrderResponseDto,
  PaginatedAdminOrdersResponseDto,
} from '@app/contract/orders/dtos/admin-order-response.dto';

/**
 * Back-office order management. Mounted under the app's `api/v1` global prefix,
 * so the live paths are `/api/v1/admin/orders…`.
 *
 * Same shell as `BooksAdminController`: a class-level `@Role(RoleTypes.ADMIN)`,
 * which `AuthorizationGuard` -> `RoleBaseAccessTokenGuard` enforces against the
 * role claim on the bearer token. `@Auth(AuthTypes.BEARER)` is stated
 * explicitly rather than relied on as the global default, because every route
 * here reads and mutates other people's orders and that guarantee should be
 * visible in this file.
 *
 * The customer-facing counterpart is `OrdersController` (`user/orders`), which
 * scopes every query to the authenticated principal. These endpoints
 * deliberately do not — that is the point of them — which is exactly why the
 * role guard is the only thing standing between them and the world.
 */
@ApiTags('Orders Admin')
@ApiBearerAuth()
@Auth(AuthTypes.BEARER)
@Role(RoleTypes.ADMIN)
@Controller('admin/orders')
export class OrdersAdminController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * List every order, newest first, in the same `{ data, meta }` envelope the
   * storefront list uses. Filterable by fulfilment/payment status and by a
   * free-text search over order number and customer e-mail.
   */
  @Get()
  @ApiOperation({ summary: 'List all orders (Admin)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated order list with customer details',
    type: PaginatedAdminOrdersResponseDto,
  })
  async findAll(@Query() query: OrderAdminQueryDto): Promise<PaginatedAdminOrdersResponseDto> {
    return this.ordersService.findAllForAdmin(query);
  }

  /**
   * Full detail for one order. No ownership filter — an admin works other
   * people's orders — so a 404 here means the row genuinely does not exist.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get one order with customer and line detail (Admin)' })
  @ApiParam({ name: 'id', description: 'Numeric order id (the digits of MP-000123)', example: 123 })
  @ApiResponse({ status: 200, description: 'Order retrieved successfully', type: AdminOrderResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<AdminOrderResponseDto> {
    return this.ordersService.findOneForAdmin(id);
  }

  /**
   * Advance an order's physical fulfilment state, optionally recording carrier
   * and tracking details, and e-mail the customer about it.
   *
   * The acting admin is taken from the bearer token via `@CurrentUser()` and
   * written to the `order_status_logs` audit row — never from the body, which
   * carries no user field at all (the global validation pipe runs with
   * `forbidNonWhitelisted`, so one cannot be added).
   *
   * Idempotent: re-submitting the state the order is already in returns it
   * unchanged and sends no second e-mail.
   */
  @Patch(':id/fulfillment')
  @ApiOperation({ summary: 'Advance an order to PROCESSING / SHIPPED / DELIVERED (Admin)' })
  @ApiParam({ name: 'id', description: 'Numeric order id', example: 123 })
  @ApiBody({ type: UpdateOrderFulfillmentDto })
  @ApiResponse({
    status: 200,
    description: 'Fulfilment updated (or already in that state — the call is idempotent)',
    type: AdminOrderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'carrier / trackingNumber missing when marking SHIPPED' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({
    status: 409,
    description:
      'FULFILLMENT_NOT_PAID (order is unpaid), FULFILLMENT_INVALID_TRANSITION (illegal or backward move, or ' +
      'cancelled order), or FULFILLMENT_NO_PHYSICAL_ITEMS (order is digital-only — nothing to ship)',
  })
  async updateFulfillment(
    @CurrentUser() user: UserData,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderFulfillmentDto,
  ): Promise<AdminOrderResponseDto> {
    return this.ordersService.updateFulfillmentAdmin(user.userId, id, dto);
  }
}
