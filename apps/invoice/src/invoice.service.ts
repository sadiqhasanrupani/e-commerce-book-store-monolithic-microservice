import { Injectable } from '@nestjs/common';

@Injectable()
export class InvoiceService {
  getHello(): string {
    return 'Hello World!';
  }
}
