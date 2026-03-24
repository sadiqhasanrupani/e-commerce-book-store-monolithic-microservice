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
import { ApiProperty } from '@nestjs/swagger';
import { PaymentProvider } from '../enums/payment-provider.enum';

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

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  pincode: string;

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
