import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';

@Module({
  imports: [],
  controllers: [InvoiceController],
  providers: [InvoiceService],
})
export class InvoiceModule {}
