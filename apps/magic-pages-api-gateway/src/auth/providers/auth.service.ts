import { Injectable } from '@nestjs/common';

import { LoginAuthDto } from '@app/contract/auth/dtos/login-auth.dto';
import { RegisterAuthDto } from '@app/contract/auth/dtos/register-auth.dto';

@Injectable()
export class AuthService {
  constructor() { } // eslint-disable-line

  register(registerAuthDto: RegisterAuthDto) {
    return {};
  }

  login(loginAuthDto: LoginAuthDto) { }

  // logout(id: number) { }
}
