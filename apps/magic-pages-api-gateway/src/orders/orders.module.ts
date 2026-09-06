import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Book } from '@app/contract/books/entities/book.entity';
import { Transaction } from '@app/contract/orders/entities/transaction.entity';
import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';

import { OrdersController } from './orders.controller';
import { OrdersAdminController } from './orders-admin.controller';
import { OrdersService } from './providers/orders.service';
import { DigitalDownloadService } from './providers/digital-download.service';
import { RazorpayProvider } from '../cart/providers/razorpay.provider';
import { PaymentSettlementService } from '../cart/services/payment-settlement.service';
import { DigitalDeliveryModule } from '../digital-delivery/digital-delivery.module';
import { PhysicalFulfillmentModule } from '../physical-fulfillment/physical-fulfillment.module';
import { InvoiceIssuanceModule } from '../invoices/invoice-issuance.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    // Cart/CartItem and OrderStatusLog are needed by the cancel flow, which
    // releases the stock reservation, un-parks the CHECKOUT cart and writes an
    // audit row.
    TypeOrmModule.forFeature([Order, OrderItem, BookFormatVariant, Book, Transaction, OrderStatusLog, Cart, CartItem]),
    // Required by the PaymentSettlementService declared below: `verifyOrder`
    // can be the first caller to observe a payment, so it must be able to
    // trigger digital delivery exactly like the webhook does.
    DigitalDeliveryModule,
    // Needed twice over: by the PaymentSettlementService declared below (which
    // queues a freshly-paid physical order for fulfilment) and by OrdersService
    // itself, whose admin ship/deliver endpoint sends the shipped/delivered
    // e-mails after its transaction commits. It re-exports MailModule's
    // MailService transitively, so nothing else here needs to import mail.
    PhysicalFulfillmentModule,
    // Also required by the PaymentSettlementService declared below: `verifyOrder`
    // can be the first caller to observe a payment, so it must raise and e-mail
    // the invoice exactly as the webhook does. Declared as its own small module
    // (rather than importing InvoicesModule) to keep AuthModule out of this graph.
    InvoiceIssuanceModule,
    // `UploadToStorageProvider` — the in-process owner of S3/MinIO reads — backs
    // the item download endpoint.
    UploadModule,
  ],
  controllers: [OrdersController, OrdersAdminController],
  // RazorpayProvider and PaymentSettlementService are declared here rather than
  // imported from CartModule: CartModule pulls in the whole cart/checkout graph
  // (Redis, throttler, schedulers), and importing it just for two classes would
  // couple the orders module to all of it. Both are stateless — the settlement
  // service holds nothing but a DataSource and does its locking in Postgres, so
  // a second instance behaves identically to the one CartModule owns.
  providers: [OrdersService, DigitalDownloadService, RazorpayProvider, PaymentSettlementService],
  exports: [TypeOrmModule],
})
export class OrdersModule { }
