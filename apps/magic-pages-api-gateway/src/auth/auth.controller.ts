import { Controller, Post, Body, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

import { AuthService } from './providers/auth.service';

import { RegisterAuthDto } from '@app/contract/auth/dtos/register-auth.dto';
import { SignInDto } from '@app/contract/auth/dtos/sign-in.dto';
import { Role } from './decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { Auth } from './decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { VerifyTokenDto } from '@app/contract/auth/dtos/verify-token.dto';
import { VerifyOtpDto } from '@app/contract/auth/dtos/verify-otp.dto';
import { RegisterDto } from '@app/contract/auth/dtos/register.dto';
import { RequestLoginOtpDto } from '@app/contract/auth/dtos/request-login-otp.dto';
import { VerifyLoginOtpDto } from '@app/contract/auth/dtos/verify-login-otp.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { } // eslint-disable-line

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully.' })
  @ApiResponse({ status: 409, description: 'User already exists.' })
  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Verify user registration with OTP' })
  @ApiResponse({ status: 201, description: 'User verified and tokens issued.' })
  @ApiResponse({ status: 400, description: 'Invalid OTP or email.' })
  @Post('register/verify')
  verifyRegistration(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyRegistration(verifyOtpDto);
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiResponse({ status: 201, description: 'User authenticated and tokens issued.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @Post('sign-in')
  login(@Body() signinDto: SignInDto) {
    return this.authService.authenticate(signinDto);
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Post('verify-token')
  verifyToken(@Body() verifyTokenDto: VerifyTokenDto, @Res({ passthrough: true }) res: Response) {
    res.cookie('access_token', 'accessToken', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 1000 * 60 * 15, // 15 min
    });

    res.cookie('refresh_token', 'refreshToken', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Request OTP for passwordless login' })
  @ApiResponse({ status: 200, description: 'OTP sent to email successfully.' })
  @ApiResponse({ status: 401, description: 'User not found or not verified.' })
  @Post('sign-in/otp/request')
  requestLoginOtp(@Body() dto: RequestLoginOtpDto) {
    return this.authService.requestLoginOtp(dto.email);
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Verify OTP and login (passwordless)' })
  @ApiResponse({ status: 200, description: 'User authenticated and token issued.' })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP.' })
  @Post('sign-in/otp/verify')
  verifyLoginOtp(@Body() dto: VerifyLoginOtpDto) {
    return this.authService.verifyLoginOtp(dto.email, dto.otp);
  }
}
