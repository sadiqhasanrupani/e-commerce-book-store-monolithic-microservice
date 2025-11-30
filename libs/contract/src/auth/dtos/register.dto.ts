import { IsEmail, IsString, MinLength, IsNotEmpty, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  @Transform(({ value }: { value: string }) => value.toLowerCase().trim())
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @IsNotEmpty()
  @IsString()
  // 1. Matches letters (a-z, A-Z) and spaces only.
  // 2. Allows single words (e.g., "John") or multiple words (e.g., "John Doe").
  @Matches(/^[a-zA-Z\s]+$/, {
    message: 'Full name must contain only letters and spaces',
  })
  @MinLength(2, { message: 'Full name must be at least 2 characters long' })
  fullName: string;
}
