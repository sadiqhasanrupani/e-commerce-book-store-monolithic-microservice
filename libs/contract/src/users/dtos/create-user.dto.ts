import { IsEmail, IsOptional, IsString, IsEnum, MinLength, ValidateIf, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

import { Roles } from '../enums/roles.enum';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  @Transform(({ value }: { value: string }) => value.trim())
  email: string;

  @ValidateIf((o: CreateUserDto) => !o.googleId)
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;

  @IsOptional()
  @IsString()
  googleId?: string;

  @IsOptional()
  @IsEnum(Roles, { message: 'Role must be BUYER or ADMIN' })
  role?: Roles;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
