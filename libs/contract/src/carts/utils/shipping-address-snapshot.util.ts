import { AddressDto } from '../dtos/checkout.dto';

/** Country assumed when the client does not send one (India-only storefront today). */
export const DEFAULT_SHIPPING_COUNTRY = 'IN';

/**
 * Canonical shape of the shipping-address snapshot persisted on
 * `orders.shipping_address` (jsonb).
 *
 * This is the single source of truth for the stored field names. It matches
 * the storefront's `SavedAddress` type and `OrderAddressResponseDto`, so the
 * read path (`OrdersService.mapAddress`) is a straight pass-through rather
 * than a guessing game between `postalCode` and `pincode`.
 */
export interface ShippingAddressSnapshot {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

const trim = (value: string | undefined | null): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Normalise a validated `AddressDto` into the canonical snapshot shape.
 *
 * Accepts either `postalCode` (canonical) or the deprecated `pincode` alias —
 * `AddressDto` guarantees at least one is present — and always writes
 * `postalCode`. Also fills in a default country so downstream consumers
 * (invoices, shipping labels) never see an empty string.
 */
export function toShippingAddressSnapshot(address: AddressDto): ShippingAddressSnapshot {
  const postalCode = trim(address.postalCode) || trim(address.pincode);
  const line2 = trim(address.line2);

  return {
    line1: trim(address.line1),
    ...(line2 ? { line2 } : {}),
    city: trim(address.city),
    state: trim(address.state),
    postalCode,
    country: trim(address.country) || DEFAULT_SHIPPING_COUNTRY,
    phone: trim(address.phone),
  };
}
