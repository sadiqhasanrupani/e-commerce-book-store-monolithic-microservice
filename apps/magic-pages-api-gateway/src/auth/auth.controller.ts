import { Controller, Post, Body, Res } from '@nestjs/common';
import { Response } from 'express';

import { AuthService } from './providers/auth.service';

import { RegisterAuthDto } from '@app/contract/auth/dtos/register-auth.dto';
import { SignInDto } from '@app/contract/auth/dtos/sign-in.dto';
import { Role } from './decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { Auth } from './decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { VerifyTokenDto } from '@app/contract/auth/dtos/verify-token.dto';

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

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Post('verify-token')
  verifyToken(@Body() verifyTokenDto: VerifyTokenDto, @Res({ passthrough: true }) res: Response) {
    res.cookie("access_token", "accessToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 1000 * 60 * 15, // 15 min
    });

    res.cookie("refresh_token", "refreshToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });
  }
}
