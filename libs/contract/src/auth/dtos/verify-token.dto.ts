import { IsEmail, IsString, Max, Min } from 'class-validator';

export class VerifyTokenDto {
  @IsEmail()
  @IsString()
  email: string;

  @IsString()
  @Min(1)
  @Max(6)
  otp: string;
}
