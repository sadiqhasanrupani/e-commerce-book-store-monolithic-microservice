import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Invoice }             from '@app/contract/invoices/entities/invoice.entity';
import { InvoiceItem }         from '@app/contract/invoices/entities/invoice-item.entity';
import { InvoiceDailyCounter } from '@app/contract/invoices/entities/invoice-daily-counter.entity';
import { Order }               from '@app/contract/orders/entities/order.entity';

import { PaginationModule }       from '../common/pagination/pagination.module';
import { AuthModule }             from '../auth/auth.module';
import { InvoicesController }     from './invoices.controller';
import { InvoicesService }        from './providers/invoices.service';
import { InvoiceNumberProvider }  from './providers/invoice-number.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceItem,
      InvoiceDailyCounter,
      Order,               // needed for order validation in service
    ]),
    PaginationModule,
    AuthModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceNumberProvider],
  exports: [InvoicesService],
})
export class InvoicesModule {}
