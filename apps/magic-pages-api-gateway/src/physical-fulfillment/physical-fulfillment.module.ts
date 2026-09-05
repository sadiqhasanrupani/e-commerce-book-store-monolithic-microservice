import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { OrderStatusLog } from '@app/contract/orders/entities/order-status-log.entity';

import { MailModule } from '../mail/mail.module';
import { PhysicalFulfillmentService } from './providers/physical-fulfillment.service';

/**
 * Post-payment fulfilment of physical (shippable) book formats.
 *
 * Its own module for exactly the reason `DigitalDeliveryModule` is: two of its
 * callers are declared in two different places. `PaymentSettlementService` is
 * provided by both `CartModule` (webhook + reconciliation cron) and
 * `OrdersModule` (`verifyOrder`), and `OrdersService` (the admin ship/deliver
 * endpoint) needs the same service. A dependency of all of those has to be
 * resolvable from both modules, so it lives here and both import this module
 * rather than each re-declaring the provider and ending up with two instances.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderStatusLog]), MailModule],
  providers: [PhysicalFulfillmentService],
  exports: [PhysicalFulfillmentService],
})
export class PhysicalFulfillmentModule {}
