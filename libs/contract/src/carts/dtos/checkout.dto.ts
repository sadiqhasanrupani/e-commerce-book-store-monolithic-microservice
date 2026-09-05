import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '../enums/payment-provider.enum';

/** True when a postal-code-ish value is absent (undefined, null or blank). */
const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * Shipping address collected at checkout.
 *
 * Field naming: `postalCode` is the canonical name across the API surface —
 * it is what the storefront's `SavedAddress` type, `OrderAddressResponseDto`
 * and the invoices `ShippingAddressDto` all use. This DTO historically used
 * `pincode` instead, which forced the storefront to rename the field on the
 * way out (`Checkout.tsx` maps `postalCode` -> `pincode`) and left the read
 * path guessing which name a stored snapshot used.
 *
 * We now accept **either** name (exactly one is required) and normalise to
 * `postalCode` before persisting — see `toShippingAddressSnapshot`. `pincode`
 * is retained purely for backwards compatibility with the currently deployed
 * storefront build and should be removed once that ships the canonical name.
 */
export class AddressDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  line1: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  line2?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  state: string;

  /**
   * Canonical postal / ZIP code. Required unless the deprecated `pincode`
   * alias is supplied instead.
   */
  @ApiPropertyOptional({ example: '400001', description: 'Postal / ZIP code. Preferred over `pincode`.' })
  @ValidateIf((o) => isBlank(o.pincode))
  @IsString()
  @IsNotEmpty({ message: 'postalCode is required (or supply the deprecated `pincode` alias)' })
  postalCode?: string;

  /**
   * @deprecated Legacy alias for `postalCode`, kept so the currently deployed
   * storefront build keeps working. Normalised away on write.
   */
  @ApiPropertyOptional({ example: '400001', deprecated: true, description: 'Deprecated alias for `postalCode`.' })
  @ValidateIf((o) => isBlank(o.postalCode))
  @IsString()
  @IsNotEmpty({ message: 'pincode is required (or supply the canonical `postalCode`)' })
  pincode?: string;

  /**
   * ISO-3166 alpha-2 country code. Optional: the storefront sends it, and
   * before this DTO accepted it the global `forbidNonWhitelisted` validation
   * pipe rejected the whole checkout request with a 400. Defaults to `IN`
   * when omitted or blank.
   */
  @ApiPropertyOptional({ example: 'IN', default: 'IN' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class CheckoutDto {
  @ApiProperty({ type: 'string' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ type: 'string' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ type: 'string' })
  @IsString()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  saveInfo: boolean;

  @ApiProperty({ enum: PaymentProvider })
  @IsEnum(PaymentProvider)
  @IsNotEmpty()
  paymentMethod: PaymentProvider;

  @ApiProperty({ type: AddressDto, required: false })
  @ValidateIf((o) => o.shippingAddress != null)
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress?: AddressDto;
}
