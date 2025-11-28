import type { ConfigType } from '@nestjs/config';
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { REQUEST_USER_KEY } from '@app/contract/auth/constants/auth.constant';
import { JwtPayload } from '@app/contract/auth/types/jwt-payload.type';
import jwtConfig from '@app/contract/auth/configs/jwt.config';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,

    @Inject(jwtConfig.KEY)
    private readonly jwtConfiguration: ConfigType<typeof jwtConfig>,
  ) {} // eslint-disable-line

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Extract the request from the context
    const request = context.switchToHttp().getRequest<Request>();

    // Extract the token from the header
    const token = this.extractTokenFromHeader(request);

    // Validate the token
    if (!token) {
      throw new UnauthorizedException({
        message: 'Unauthorized',
        token: token,
      });
    }

    try {
      const payload: JwtPayload = await this.jwtService.verifyAsync(token, this.jwtConfiguration);

      request[REQUEST_USER_KEY] = payload;
    } catch {
      throw new UnauthorizedException({
        message: 'Unauthorized',
        token: token,
      });
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
