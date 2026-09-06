import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Invoice } from '@app/contract/invoices/entities/invoice.entity';
import { InvoiceItem } from '@app/contract/invoices/entities/invoice-item.entity';
import { InvoiceDailyCounter } from '@app/contract/invoices/entities/invoice-daily-counter.entity';
import { Order } from '@app/contract/orders/entities/order.entity';

import { MailModule } from '../mail/mail.module';
import { InvoiceIssuanceService } from './providers/invoice-issuance.service';
import { InvoiceNumberProvider } from './providers/invoice-number.provider';

/**
 * Automatic, payment-driven invoicing.
 *
 * Deliberately a second, smaller module beside `InvoicesModule` rather than an
 * export from it, for the same reason `DigitalDeliveryModule` exists:
 * `PaymentSettlementService` — the only caller — is declared in two places
 * (`CartModule` for the webhook and the reconciliation cron, `OrdersModule` for
 * `verifyOrder`), so its dependencies must be resolvable from both.
 *
 * Why not just import `InvoicesModule` there: it declares the admin
 * `InvoicesController`, so it imports `AuthModule`, which pulls in `UsersModule`
 * (via `forwardRef`) and `RmqModule`. Making the cart and orders graphs depend
 * on all of that in order to write a row would be real coupling and a
 * `forwardRef` cycle waiting to happen — exactly the argument `MailModule`
 * documents for not re-exporting `MailService` from `AuthModule`.
 *
 * `InvoiceNumberProvider` is declared here as well as in `InvoicesModule`. That
 * is safe and intentional: it holds no state (its atomicity comes from a single
 * Postgres `INSERT … ON CONFLICT DO UPDATE`, not from anything in the class),
 * so a second instance behaves identically — the same argument `OrdersModule`
 * already makes for re-declaring `PaymentSettlementService`. Crucially it is
 * the SAME class, so there is still exactly one invoice-numbering scheme.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Invoice, InvoiceItem, InvoiceDailyCounter, Order]), MailModule],
  providers: [InvoiceIssuanceService, InvoiceNumberProvider],
  exports: [InvoiceIssuanceService],
})
export class InvoiceIssuanceModule {}
