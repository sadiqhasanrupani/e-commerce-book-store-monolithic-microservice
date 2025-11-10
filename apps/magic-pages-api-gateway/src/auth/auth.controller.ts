import { Controller, Post, Body } from '@nestjs/common';

import { AuthService } from './providers/auth.service';

import { RegisterAuthDto } from '@app/contract/auth/dtos/register-auth.dto';
import { SignInDto } from '@app/contract/auth/dtos/sign-in.dto';
import { Role } from './decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { Auth } from './decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { } // eslint-disable-line

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Post('register')
  register(@Body() registerAuthDto: RegisterAuthDto) {
    return this.authService.register(registerAuthDto);
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Post('sign-in')
  login(@Body() signinDto: SignInDto) {
    return this.authService.authenticate(signinDto);
  }
}
