import { Controller, Post, Body } from '@nestjs/common';

import { AuthService } from './providers/auth.service';

import { RegisterAuthDto } from '@app/contract/auth/dtos/register-auth.dto';
import { SignInDto } from '@app/contract/auth/dtos/sign-in.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { } // eslint-disable-line

  @Post('register')
  register(@Body() registerAuthDto: RegisterAuthDto) {
    return this.authService.register(registerAuthDto);
  }

  @Post('sign-in')
  login(@Body() signinDto: SignInDto) {
    return this.authService.authenticate(signinDto);
  }
}
