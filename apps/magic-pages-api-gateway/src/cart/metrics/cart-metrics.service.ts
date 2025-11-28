import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

@Injectable()
export class CartMetricsService {
  constructor(
    @InjectMetric('cart_operations_total')
    public cartOperationsTotal: Counter<string>,
    @InjectMetric('cart_items_count')
    public cartItemsCount: Gauge<string>,
    @InjectMetric('checkout_requests_total')
    public checkoutRequestsTotal: Counter<string>,
    @InjectMetric('checkout_duration_seconds')
    public checkoutDuration: Histogram<string>,
    @InjectMetric('payment_webhook_total')
    public paymentWebhookTotal: Counter<string>,
    @InjectMetric('stock_reservation_total')
    public stockReservationTotal: Counter<string>,
    @InjectMetric('cache_operations_total')
    public cacheOperationsTotal: Counter<string>,
  ) { }

  incrementCartOperation(operation: 'add' | 'update' | 'remove' | 'clear', status: 'success' | 'failed') {
    this.cartOperationsTotal.inc({ operation, status });
  }

  updateCartItemsCount(count: number) {
    this.cartItemsCount.set(count);
  }

  incrementCheckoutRequest(status: 'success' | 'failed' | 'pending') {
    this.checkoutRequestsTotal.inc({ status });
  }

  observeCheckoutDuration(duration: number) {
    this.checkoutDuration.observe(duration);
  }

  incrementPaymentWebhook(status: 'success' | 'failed' | 'pending' | 'invalid_signature', provider: string) {
    this.paymentWebhookTotal.inc({ status, provider });
  }

  incrementStockReservation(status: 'reserved' | 'released' | 'failed') {
    this.stockReservationTotal.inc({ status });
  }

  incrementCacheOperation(operation: 'hit' | 'miss' | 'set' | 'del') {
    this.cacheOperationsTotal.inc({ operation });
  }
}
