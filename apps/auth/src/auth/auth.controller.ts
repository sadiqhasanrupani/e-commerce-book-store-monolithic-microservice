import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { LoginAuthDto } from '@app/contract/auth/dtos/login-auth.dto';
import { RegisterAuthDto } from '@app/contract/auth/dtos/register-auth.dto';
import { AUTH_PATTERNS } from '@app/contract/auth/patterns/auth.patterns';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(AUTH_PATTERNS.REGISTER)
  register(@Payload() registerAuthDto: RegisterAuthDto) {
    return this.authService.register(registerAuthDto);
  }

  @MessagePattern(AUTH_PATTERNS.LOGIN)
  login(@Payload() loginUserDto: LoginAuthDto) {
    return this.authService.login(loginUserDto);
  }

  @MessagePattern(AUTH_PATTERNS.VALIDATE)
  validate() {
    return this.authService.validate();
  }

  @MessagePattern('auth.verifyOtp')
  verifyOtp(@Payload() payload: { email: string; otp: string }) {
    return this.authService.verifyOtp(payload.email, payload.otp);
  }
}
