import { IsEmail, IsOptional, IsString, IsEnum, MinLength, ValidateIf } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @ValidateIf((o: CreateUserDto) => !o.googleId)
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;

  @IsOptional()
  @IsString()
  googleId?: string;

  @IsOptional()
  @IsEnum(['buyer', 'admin'], { message: 'Role must be buyer or admin' })
  role?: 'buyer' | 'admin';

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
