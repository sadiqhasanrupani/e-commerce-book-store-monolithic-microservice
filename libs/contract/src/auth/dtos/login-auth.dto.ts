import { IsString, IsNotEmpty, IsEmail, Matches  } from "class-validator";
import { REGEXES } from "libs/contract/regex/regex";

export class LoginAuthDto {

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