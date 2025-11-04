import { IsNotEmpty, IsEmail, IsString, Matches, } from "class-validator";
import { REGEXES } from "libs/contract/regex/regex";

export class RegisterAuthDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @Matches(REGEXES.passwordRegex, {
    message:
      'Password must be at least 8 characters long, contain uppercase, lowercase, number, and special character',
  })
  password: string;
}