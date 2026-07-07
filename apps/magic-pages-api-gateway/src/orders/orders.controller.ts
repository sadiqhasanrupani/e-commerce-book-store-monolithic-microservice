import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { CurrentUser } from 'libs/common/src/decorators/current-user.decorator';
import { UserData } from 'libs/common/src/types/user-data.type';

import { OrdersService } from './providers/orders.service';
import { OrderQueryDto } from '@app/contract/orders/dtos/order-query.dto';
import { OrderResponseDto } from '@app/contract/orders/dtos/order-response.dto';
import { PaginatedOrdersResponseDto } from '@app/contract/orders/dtos/paginated-orders-response.dto';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('user/orders')
@Auth(AuthTypes.BEARER)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * List the authenticated user's orders, newest first.
   * Returns a `{ data, meta }` pagination envelope.
   */
  @Get()
  @ApiOperation({ summary: 'List current user orders (newest first)' })
  @ApiResponse({
    status: 200,
    description: 'Orders retrieved successfully',
    type: PaginatedOrdersResponseDto,
  })
  async getOrders(
    @CurrentUser() user: UserData,
    @Query() query: OrderQueryDto,
  ): Promise<PaginatedOrdersResponseDto> {
    return this.ordersService.findAllForUser(user.userId, query);
  }

  /**
   * Fetch a single order belonging to the authenticated user.
   * Returns 404 if the order does not exist or is not owned by the user.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get one order owned by the current user' })
  @ApiResponse({
    status: 200,
    description: 'Order retrieved successfully',
    type: OrderResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrder(
    @CurrentUser() user: UserData,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OrderResponseDto> {
    return this.ordersService.findOneForUser(user.userId, id);
  }
}
