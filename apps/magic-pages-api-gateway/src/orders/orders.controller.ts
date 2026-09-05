import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { CurrentUser } from 'libs/common/src/decorators/current-user.decorator';
import { UserData } from 'libs/common/src/types/user-data.type';

import { OrdersService } from './providers/orders.service';
import { DigitalDownloadService } from './providers/digital-download.service';
import { OrderQueryDto } from '@app/contract/orders/dtos/order-query.dto';
import { OrderResponseDto } from '@app/contract/orders/dtos/order-response.dto';
import { PaginatedOrdersResponseDto } from '@app/contract/orders/dtos/paginated-orders-response.dto';
import { VerifyOrderResponseDto } from '@app/contract/orders/dtos/verify-order-response.dto';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('user/orders')
@Auth(AuthTypes.BEARER)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly digitalDownloadService: DigitalDownloadService,
  ) { }

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
  async getOrders(@CurrentUser() user: UserData, @Query() query: OrderQueryDto): Promise<PaginatedOrdersResponseDto> {
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
  async getOrder(@CurrentUser() user: UserData, @Param('id', ParseIntPipe) id: number): Promise<OrderResponseDto> {
    return this.ordersService.findOneForUser(user.userId, id);
  }

  /**
   * Stream the digital material of one purchased order line.
   *
   * This is where the post-payment delivery e-mail ultimately leads, and the
   * only sanctioned way to obtain a paid book file. The e-mail links to the
   * storefront order page rather than here, because this endpoint needs the
   * user's bearer token — which an email client cannot attach.
   *
   * Authorisation is enforced in `DigitalDownloadService`: the line must belong
   * to an order owned by the authenticated principal, that order must be PAID,
   * and the line must be a digital format. Nothing is trusted from the path
   * beyond which row to look for.
   */
  @Get(':id/items/:itemId/download')
  @ApiOperation({ summary: 'Download the digital material of a purchased order item' })
  @ApiProduces('application/octet-stream')
  @ApiResponse({ status: 200, description: 'The file stream' })
  @ApiResponse({ status: 403, description: 'Order is not paid for yet' })
  @ApiResponse({ status: 404, description: 'Item not found, not owned by the current user, or not downloadable' })
  async downloadItem(
    @CurrentUser() user: UserData,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ): Promise<StreamableFile> {
    const download = await this.digitalDownloadService.getDownload(user.userId, id, itemId);

    // `StreamableFile` (rather than a raw `@Res()`) keeps this handler inside
    // Nest's response pipeline, so the exceptions the service throws are still
    // rendered by the global exception filter instead of hanging the socket.
    return new StreamableFile(download.stream, {
      type: download.contentType,
      disposition: `attachment; filename="${download.filename}"`,
    });
  }

  /**
   * Cancel an order owned by the authenticated user.
   *
   * `POST` (not `PATCH`) to match the path the storefront already calls
   * (`profileApi.cancelOrder` -> `POST /user/orders/:id/cancel`). Only
   * pre-payment orders may be cancelled; anything else returns 409 with a
   * typed `code`.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an unpaid order owned by the current user' })
  @ApiResponse({
    status: 200,
    description: 'Order cancelled (or already cancelled — the call is idempotent)',
    type: OrderResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Order not found or not owned by the current user' })
  @ApiResponse({ status: 409, description: 'Order is already paid or past the point of cancellation' })
  async cancelOrder(@CurrentUser() user: UserData, @Param('id', ParseIntPipe) id: number): Promise<OrderResponseDto> {
    return this.ordersService.cancelOrder(user.userId, id);
  }

  /**
   * Resolve a Razorpay order reference (`razorpay_order_id`) back to our
   * payment state. The storefront's success page polls this after the modal
   * closes, since it usually gets back to us before the webhook does.
   *
   * The path param is the *gateway* reference, not our internal order id — so
   * no `ParseIntPipe`. Ownership is enforced in the service against the
   * authenticated principal, never against anything in the request.
   */
  @Get('verify/:gatewayOrderId')
  @ApiOperation({ summary: 'Verify a payment by its Razorpay order reference' })
  @ApiResponse({
    status: 200,
    description: 'Current payment state for the reference',
    type: VerifyOrderResponseDto,
  })
  @ApiResponse({ status: 404, description: 'No payment with that reference belongs to the current user' })
  async verifyOrder(
    @CurrentUser() user: UserData,
    @Param('gatewayOrderId') gatewayOrderId: string,
  ): Promise<VerifyOrderResponseDto> {
    return this.ordersService.verifyOrder(user.userId, gatewayOrderId);
  }
}
