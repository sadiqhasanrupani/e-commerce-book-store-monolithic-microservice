import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { RazorpayProvider } from './providers/razorpay.provider';
import { PaymentProvider, RefundRequest } from './interfaces/payment-provider.interface';
import { TRANSACTION_PROVIDERS, TransactionProvider } from '@app/contract/carts/enums/payment-provider.enum';

import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly razorpayProvider: RazorpayProvider,
  ) { }

  @Get()
  @ApiOperation({ summary: 'List all transactions' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: TransactionStatus })
  // Filtering still allows `phonepe` so admins can find historical rows, even
  // though no new PhonePe transaction can be created.
  @ApiQuery({ name: 'provider', required: false, enum: TRANSACTION_PROVIDERS })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'ISO 8601 date string' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'ISO 8601 date string' })
  @ApiQuery({ name: 'minAmount', required: false, type: Number })
  @ApiQuery({ name: 'maxAmount', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of transactions' })
  async findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('status') status?: TransactionStatus,
    @Query('provider') provider?: TransactionProvider,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('minAmount') minAmount?: number,
    @Query('maxAmount') maxAmount?: number,
  ) {
    const skip = (page - 1) * limit;
    const queryBuilder = this.transactionRepository.createQueryBuilder('transaction')
      .leftJoinAndSelect('transaction.order', 'order')
      .leftJoinAndSelect('order.user', 'user')
      .orderBy('transaction.created_at', 'DESC')
      .skip(skip)
      .take(limit);

    if (status) {
      queryBuilder.andWhere('transaction.status = :status', { status });
    }

    if (provider) {
      queryBuilder.andWhere('transaction.provider = :provider', { provider });
    }

    if (startDate) {
      queryBuilder.andWhere('transaction.created_at >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere('transaction.created_at <= :endDate', { endDate });
    }

    if (minAmount) {
      queryBuilder.andWhere('transaction.amount >= :minAmount', { minAmount });
    }

    if (maxAmount) {
      queryBuilder.andWhere('transaction.amount <= :maxAmount', { maxAmount });
    }

    // Execute count and data queries in parallel for efficiency
    const [items, total] = await Promise.all([
      queryBuilder.getMany(),
      queryBuilder.getCount(),
    ]);

    return {
      data: items,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a transaction by ID' })
  @ApiResponse({ status: 200, description: 'Transaction details' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async findOne(@Param('id') id: string) {
    const transaction = await this.transactionRepository.findOne({
      where: { id },
      relations: ['order', 'order.user', 'refunds'],
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate a refund for a transaction' })
  @ApiResponse({ status: 200, description: 'Refund initiated' })
  async refund(
    @Param('id') id: string,
    @Body() body: { amount?: number; reason?: string },
  ) {
    const transaction = await this.transactionRepository.findOne({ where: { id } });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.status !== TransactionStatus.SUCCESS) {
      throw new BadRequestException('Cannot refund a non-successful transaction');
    }

    const refundAmount = body.amount || Number(transaction.amount);
    const reason = body.reason || 'Admin initiated refund';

    // Razorpay refunds are keyed by the Order ID (gateway_ref_id) we stored at
    // checkout. Legacy PhonePe transactions can no longer be refunded through
    // this endpoint — that provider is gone; those must be handled in the
    // PhonePe merchant dashboard.
    if (transaction.provider !== PaymentProvider.RAZORPAY) {
      throw new BadRequestException(
        `Refunds are only supported for Razorpay transactions (this one is '${transaction.provider}')`,
      );
    }

    if (!transaction.gateway_ref_id) {
      throw new BadRequestException('Transaction has no gateway reference to refund against');
    }

    const refundRequest: RefundRequest = {
      transactionId: transaction.gateway_ref_id,
      amount: refundAmount,
      reason: reason,
    };

    let response;
    try {
      response = await this.razorpayProvider.initiateRefund(refundRequest);

      this.logger.log(`Refund initiated for transaction ${id}: ${JSON.stringify(response)}`);

      // Optionally update transaction status or create a Refund entity record here
      // For now, just returning the response

      return {
        success: true,
        data: response,
      };

    } catch (error) {
      this.logger.error(`Refund failed for transaction ${id}`, error);
      throw new BadRequestException(error.message || 'Refund failed');
    }
  }
}
