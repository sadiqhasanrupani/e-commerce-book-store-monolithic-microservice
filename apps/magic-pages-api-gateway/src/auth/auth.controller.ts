
import { Controller, Post, Body, Res, HttpStatus, Get, Ip, Headers } from '@nestjs/common';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';

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
import { MeResponseDto } from '@app/contract/users/dtos/me-response.dto';
import { ActiveUser } from './decorator/active-user.decorator';
import { IActiveUser } from '@app/contract/auth/interfaces/active-user.interface';
// import { GoogleAuthenticationService } from './providers/google-authentication.service';
import { UserContextService } from './providers/user-context.service';
// import { GoogleTokenDto } from './dtos/google-token.dto';
// import { RefreshTokenDto } from './dtos/refresh-token.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    // private readonly googleAuthService: GoogleAuthenticationService,
    private readonly userContextService: UserContextService,
  ) { } // eslint-disable-line

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

  /*
  @Auth(AuthTypes.NONE)
  @ApiOperation({ summary: 'Sign in with Google token' })
  @ApiResponse({ status: 201, description: 'User authenticated with Google and tokens issued.' })
  @ApiResponse({ status: 401, description: 'Invalid Google token.' })
  @Post('google')
  async googleAuth(@Body() googleTokenDto: GoogleTokenDto) {
    // return this.googleAuthService.authenticate(googleTokenDto);
    return null;
  }
  */

  @Get('user/context')
  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  getUserContext(@Ip() ip: string, @Headers('x-forwarded-for') xForwardedFor: string) {
    // Prefer X-Forwarded-For if available (behind proxy/LB)
    const clientIp = xForwardedFor ? xForwardedFor.split(',')[0].trim() : ip;
    return this.userContextService.resolveContext(clientIp);
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

  @Get('me')
  @Auth(AuthTypes.BEARER)
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  async getProfile(@ActiveUser() user: IActiveUser): Promise<MeResponseDto> {
    const userEntity = await this.authService.getMe(user.sub);
    return plainToInstance(MeResponseDto, userEntity, { excludeExtraneousValues: true });
  }
}
