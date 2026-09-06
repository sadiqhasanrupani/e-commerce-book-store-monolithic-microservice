import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateBookVariantDto } from './update-book-variant.dto';
import { CreateBookVariantDto } from './create-book-variant.dto';

/**
 * Validation rules for a book variant's editable fields.
 *
 * This spec exists because of a bug that was invisible from the service side:
 * `taxPercentage` was declared on `CreateBookVariantDto` but NOT on
 * `UpdateBookVariantDto`. The app's global pipe runs with
 * `forbidNonWhitelisted`, so an undeclared property is not ignored — it is a
 * 400. The admin panel's edit form sends `taxPercentage` whenever the
 * "include tax" toggle is on, so editing any taxed variant failed outright
 * while creating the identical variant succeeded.
 *
 * A service test would not have caught it: the request never reached the
 * service. The asymmetry itself is the bug, so the last block here asserts the
 * two DTOs stay in step.
 *
 * The options below mirror the global `HybridValidationPipe`
 * (`whitelist` + `forbidNonWhitelisted` + `transform`), so what passes here is
 * what passes in production.
 */
describe('UpdateBookVariantDto', () => {
  /** Validate a raw body and return `property:constraint` keys for failures. */
  const check = (plain: Record<string, unknown>): string[] =>
    validateSync(plainToInstance(UpdateBookVariantDto, plain), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }).flatMap((error) =>
      Object.keys(error.constraints ?? {}).map((constraint) => `${error.property}:${constraint}`),
    );

  describe('taxPercentage is accepted on edit', () => {
    /** The exact shape the admin edit form sends for a taxed variant. */
    it('accepts a taxed variant the way the admin panel sends it', () => {
      expect(
        check({ id: 1, priceCents: 25000, includeTax: true, taxPercentage: 18 }),
      ).toEqual([]);
    });

    it('accepts the field on its own', () => {
      expect(check({ taxPercentage: 5 })).toEqual([]);
    });

    it('accepts a fractional rate', () => {
      expect(check({ taxPercentage: 12.5 })).toEqual([]);
    });

    it('still allows the field to be omitted entirely', () => {
      expect(check({ priceCents: 100 })).toEqual([]);
    });
  });

  describe('taxPercentage is bounded', () => {
    it('rejects a negative rate', () => {
      expect(check({ taxPercentage: -1 })).toEqual(expect.arrayContaining(['taxPercentage:min']));
    });

    it('rejects a rate above 100%', () => {
      expect(check({ taxPercentage: 101 })).toEqual(expect.arrayContaining(['taxPercentage:max']));
    });

    it('rejects a non-numeric rate', () => {
      expect(check({ taxPercentage: 'eighteen' })).toEqual(
        expect.arrayContaining(['taxPercentage:isNumber']),
      );
    });
  });

  describe('unknown properties are still refused', () => {
    /**
     * Guards the fix from over-correcting: the whitelist is what caught the
     * original bug, so it must keep rejecting genuinely unknown fields rather
     * than being loosened to make the form work.
     */
    it('rejects a property no DTO declares', () => {
      expect(check({ taxPercentage: 18, notARealField: true })).toEqual(
        expect.arrayContaining(['notARealField:whitelistValidation']),
      );
    });

    /**
     * The backend models a discount as `originalPrice` vs `price`, not as a
     * percentage. The admin panel carries a `discountPercentage` in its own
     * types, and sending it verbatim would 400 — it has to be resolved into
     * the two price fields before the request goes out.
     */
    it('rejects discountPercentage, which the backend does not model', () => {
      expect(check({ discountPercentage: 10 })).toEqual(
        expect.arrayContaining(['discountPercentage:whitelistValidation']),
      );
    });
  });

  describe('create and update stay in step', () => {
    /**
     * The original defect was a field present on one DTO and absent on the
     * other. This asserts the shared price/tax vocabulary validates
     * identically on both, so the two cannot drift apart again unnoticed.
     */
    const shared = { priceCents: 25000, originalPriceCents: 30000, includeTax: true, taxPercentage: 18 };

    it('accepts the same tax and price payload on create', () => {
      const errors = validateSync(plainToInstance(CreateBookVariantDto, { format: 'paperback', ...shared }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors).toEqual([]);
    });

    it('bounds the rate identically on create', () => {
      const errors = validateSync(plainToInstance(CreateBookVariantDto, { format: 'paperback', priceCents: 1, taxPercentage: 101 }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).flatMap((error) => Object.keys(error.constraints ?? {}).map((c) => `${error.property}:${c}`));
      expect(errors).toEqual(expect.arrayContaining(['taxPercentage:max']));
    });
  });
});
