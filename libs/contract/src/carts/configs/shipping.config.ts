import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

/**
 * Flat-rate shipping configuration.
 *
 * v1 is deliberately a single number: one flat charge applied to any order that
 * contains at least one physical (shippable) line, and nothing at all for a
 * digital-only order. Zone tables, weight bands and courier rate APIs are out
 * of scope — when they arrive they replace this factory, not its callers.
 *
 * The value is expressed in PAISE (minor units) because that is how the
 * storefront and the payment gateway talk about money, and because an integer
 * cannot drift the way `49.90` can. It is converted to major units exactly once
 * — in `ShippingRateService` — before being persisted to `orders.shipping_cost`
 * or added to `orders.total_amount`, both of which are numeric(10,2) in rupees.
 *
 * Default 0: an unset variable means "we do not charge shipping", which is the
 * behaviour that was live before this feature. It must never silently invent a
 * price the storefront did not show the customer.
 */
export default registerAs('shipping', () => ({
  flatRatePaise: parseShippingRate(process.env.SHIPPING_FLAT_RATE_PAISE),
}));

/**
 * Environment rules for this config, spread into the app's Joi schema so a
 * typo'd rate is a boot failure rather than a silently-free shipping bug.
 * Optional with a default so an existing `.env` keeps booting unchanged.
 */
export const shippingEnvironmentSchema = {
  SHIPPING_FLAT_RATE_PAISE: Joi.number().integer().min(0).default(0),
};

/**
 * Parse defensively rather than trusting the Joi default to have been written
 * back onto `process.env`: config factories and schema validation are separate
 * passes in `@nestjs/config`, and a non-numeric value reaching `Number()` here
 * would otherwise become `NaN` and poison every order total.
 */
function parseShippingRate(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
