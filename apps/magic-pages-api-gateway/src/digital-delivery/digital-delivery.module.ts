import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderItem } from '@app/contract/orders/entities/order-item.entity';

import { MailModule } from '../mail/mail.module';
import { DigitalDeliveryService } from './providers/digital-delivery.service';

/**
 * Post-payment delivery of digital book formats.
 *
 * It exists as its own module because `PaymentSettlementService` — its only
 * caller — is declared in two places: `CartModule` (webhook + reconciliation
 * cron) and `OrdersModule` (`verifyOrder`). A dependency of that service has to
 * be resolvable from both, so it lives here and both import this module rather
 * than each re-declaring the provider and ending up with two instances.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem]), MailModule],
  providers: [DigitalDeliveryService],
  exports: [DigitalDeliveryService],
})
export class DigitalDeliveryModule {}
