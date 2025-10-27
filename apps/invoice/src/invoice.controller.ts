import { Controller, Get } from '@nestjs/common';
import { InvoiceService } from './invoice.service';

@Controller()
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get()
  getHello(): string {
    return this.invoiceService.getHello();
  }
}
