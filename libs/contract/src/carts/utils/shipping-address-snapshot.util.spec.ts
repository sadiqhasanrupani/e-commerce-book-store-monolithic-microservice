import { AddressDto } from '../dtos/checkout.dto';
import { DEFAULT_SHIPPING_COUNTRY, toShippingAddressSnapshot } from './shipping-address-snapshot.util';

const base = (overrides: Partial<AddressDto> = {}): AddressDto =>
  ({
    line1: '12 MG Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    phone: '9876543210',
    ...overrides,
  }) as AddressDto;

describe('toShippingAddressSnapshot', () => {
  it('uses the canonical postalCode when present', () => {
    expect(toShippingAddressSnapshot(base({ postalCode: '400001' })).postalCode).toBe('400001');
  });

  it('accepts the deprecated pincode alias and normalises it to postalCode', () => {
    const snapshot = toShippingAddressSnapshot(base({ pincode: '400001' }));

    expect(snapshot.postalCode).toBe('400001');
    expect(snapshot).not.toHaveProperty('pincode');
  });

  it('prefers postalCode when a client sends both', () => {
    expect(toShippingAddressSnapshot(base({ postalCode: '400001', pincode: '999999' })).postalCode).toBe('400001');
  });

  it('defaults a missing or blank country', () => {
    expect(toShippingAddressSnapshot(base({ postalCode: '400001' })).country).toBe(DEFAULT_SHIPPING_COUNTRY);
    expect(toShippingAddressSnapshot(base({ postalCode: '400001', country: '  ' })).country).toBe(
      DEFAULT_SHIPPING_COUNTRY,
    );
  });

  it('keeps a supplied country and trims whitespace throughout', () => {
    const snapshot = toShippingAddressSnapshot(
      base({ postalCode: ' 400001 ', country: ' US ', line1: '  12 MG Road  ' }),
    );

    expect(snapshot.country).toBe('US');
    expect(snapshot.postalCode).toBe('400001');
    expect(snapshot.line1).toBe('12 MG Road');
  });

  it('omits line2 entirely when it is blank, and keeps it when set', () => {
    expect(toShippingAddressSnapshot(base({ postalCode: '400001', line2: '   ' }))).not.toHaveProperty('line2');
    expect(toShippingAddressSnapshot(base({ postalCode: '400001', line2: 'Flat 4B' })).line2).toBe('Flat 4B');
  });
});

describe('AddressDto validation', () => {
  const validate = async (payload: Record<string, unknown>) => {
    const { validate: classValidate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const errors = await classValidate(plainToInstance(AddressDto, payload));
    return errors.map((e) => e.property);
  };

  const required = { line1: '12 MG Road', city: 'Mumbai', state: 'Maharashtra', phone: '9876543210' };

  it('accepts the canonical postalCode alone', async () => {
    await expect(validate({ ...required, postalCode: '400001' })).resolves.toEqual([]);
  });

  it('accepts the deprecated pincode alone (currently deployed storefront)', async () => {
    await expect(validate({ ...required, pincode: '400001' })).resolves.toEqual([]);
  });

  it('accepts the optional country the storefront sends', async () => {
    await expect(validate({ ...required, postalCode: '400001', country: 'IN' })).resolves.toEqual([]);
  });

  it('rejects an address with neither postalCode nor pincode', async () => {
    await expect(validate(required)).resolves.toEqual(expect.arrayContaining(['postalCode', 'pincode']));
  });
});
