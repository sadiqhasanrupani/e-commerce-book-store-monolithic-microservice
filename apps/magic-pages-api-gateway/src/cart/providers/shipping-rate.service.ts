import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';

/** Paise per rupee. The one place the minor/major conversion factor is written. */
const PAISE_PER_MAJOR_UNIT = 100;

/**
 * Resolves what shipping to charge.
 *
 * This exists so the number appears in exactly one place. Before it, shipping
 * was the literal `0` in three separate files (`cart.service`,
 * `cart-merge.service`, `checkout.service`), which is precisely the shape of
 * bug where a cart quotes one price and checkout charges another.
 *
 * v1 rule, in full: one flat rate (`SHIPPING_FLAT_RATE_PAISE`) if the basket
 * contains at least one physical line, otherwise nothing. No zones, no weight,
 * no per-item multiplication — a two-book order ships once.
 *
 * Units: the config is in paise (integer, gateway-native); everything this
 * service returns is in MAJOR units (rupees) because that is what
 * `orders.total_amount`, `orders.shipping_cost` and the cart summary DTOs all
 * use. The conversion happens here and nowhere else.
 */
@Injectable()
export class ShippingRateService {
  constructor(private readonly configService: ConfigService) {}

  /** The configured flat rate in paise. 0 when unset. */
  get flatRatePaise(): number {
    return this.configService.get<number>('shipping.flatRatePaise') ?? 0;
  }

  /**
   * The shipping charge, in major units, for a basket that does or does not
   * contain something shippable.
   *
   * @param hasPhysicalItems whether the basket contains at least one physical
   *        line. Passed in rather than derived here so each caller can compute
   *        it from whatever it already holds (cart items, locked variants,
   *        order items) without this service needing a database.
   */
  resolveShippingCost(hasPhysicalItems: boolean): number {
    if (!hasPhysicalItems) {
      return 0;
    }

    // Integer paise / 100 lands exactly on a 2-decimal value, which is what the
    // numeric(10,2) columns store.
    return this.flatRatePaise / PAISE_PER_MAJOR_UNIT;
  }

  /**
   * Whether a loaded cart's items include anything shippable.
   *
   * An item whose `bookFormatVariant` relation was not loaded counts as NOT
   * physical. That is the deliberate direction to fail in: quoting no shipping
   * on a cart we cannot classify under-charges by the flat rate, whereas
   * inventing a charge for a digital-only basket is a customer-visible billing
   * error. `CheckoutService` re-derives this from rows it has locked, so the
   * money actually taken is never decided by this optimistic read.
   */
  cartHasPhysicalItems(items: Array<Pick<CartItem, 'bookFormatVariant'>> | undefined | null): boolean {
    return (items ?? []).some((item) => !!item.bookFormatVariant && isPhysicalFormat(item.bookFormatVariant.format));
  }
}
