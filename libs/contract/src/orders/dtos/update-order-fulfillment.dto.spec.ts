import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateOrderFulfillmentDto } from './update-order-fulfillment.dto';
import { FulfillmentStatus } from '../enums/order-status.enum';

/**
 * Validation rules for the admin fulfilment endpoint's body.
 *
 * Worth its own spec because the conditional-required rule is easy to write and
 * easy to write *wrongly*: pairing `@ValidateIf` with `@IsOptional` looks
 * correct but silently disables the whole guard, because `@IsOptional`
 * short-circuits every other constraint on an undefined value. A regression
 * there would not fail any service test — it would just start letting
 * "your parcel has shipped" e-mails go out with no carrier and no AWB.
 *
 * The options below mirror the app's global `HybridValidationPipe`
 * (`whitelist` + `forbidNonWhitelisted` + `transform`), so what passes here is
 * what passes in production.
 */
describe('UpdateOrderFulfillmentDto', () => {
  /** Validate a raw body and return `property:constraint` keys for failures. */
  const check = (plain: Record<string, unknown>): string[] =>
    validateSync(plainToInstance(UpdateOrderFulfillmentDto, plain), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }).flatMap((error) => Object.keys(error.constraints ?? {}).map((constraint) => `${error.property}:${constraint}`));

  describe('shipment details are conditionally required', () => {
    it('rejects SHIPPED with neither carrier nor tracking number', () => {
      expect(check({ fulfillmentStatus: FulfillmentStatus.SHIPPED })).toEqual(
        expect.arrayContaining(['carrier:isNotEmpty', 'trackingNumber:isNotEmpty']),
      );
    });

    /** Whitespace is not a carrier — the transform trims before the check. */
    it('rejects SHIPPED with a blank carrier', () => {
      expect(check({ fulfillmentStatus: FulfillmentStatus.SHIPPED, carrier: '   ', trackingNumber: 'AWB123' })).toEqual(
        expect.arrayContaining(['carrier:isNotEmpty']),
      );
    });

    it('accepts SHIPPED when both are supplied', () => {
      expect(
        check({ fulfillmentStatus: FulfillmentStatus.SHIPPED, carrier: 'Delhivery', trackingNumber: 'AWB123' }),
      ).toEqual([]);
    });

    /**
     * The other half of the conditional: marking an order DELIVERED must not
     * demand the tracking fields again, since they were stored at ship time.
     */
    it('accepts DELIVERED with no shipment fields at all', () => {
      expect(check({ fulfillmentStatus: FulfillmentStatus.DELIVERED })).toEqual([]);
    });
  });

  it('rejects a status outside the enum', () => {
    expect(check({ fulfillmentStatus: 'NOPE' })).toEqual(expect.arrayContaining(['fulfillmentStatus:isEnum']));
  });

  /**
   * `trackingUrl` is rendered as an anchor in a customer e-mail and on the
   * storefront, so a non-http(s) scheme must never reach either.
   */
  it('rejects a javascript: tracking URL', () => {
    expect(check({ fulfillmentStatus: FulfillmentStatus.PROCESSING, trackingUrl: 'javascript:alert(1)' })).toEqual(
      expect.arrayContaining(['trackingUrl:isUrl']),
    );
  });

  /**
   * The endpoint must not become a back door for editing anything else on the
   * order — `payment_status` above all.
   */
  it('rejects properties that are not part of the contract', () => {
    expect(check({ fulfillmentStatus: FulfillmentStatus.PROCESSING, paymentStatus: 'PAID' })).toEqual(
      expect.arrayContaining(['paymentStatus:whitelistValidation']),
    );
  });
});
