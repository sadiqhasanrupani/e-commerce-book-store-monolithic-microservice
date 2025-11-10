import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { AccessTokenGuard } from '../access-token/access-token.guard';
import { AUTH_TYPE_KEY } from '@app/contract/auth/constants/auth.constant';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  private static readonly defaultAuthType = AuthTypes.BEARER;

  private readonly authTypeGuardMap: Record<AuthTypes, CanActivate | CanActivate[]>;

  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokenGuard: AccessTokenGuard,
  ) {
    this.authTypeGuardMap = {
      [AuthTypes.BEARER]: this.accessTokenGuard,
      [AuthTypes.NONE]: { canActivate: () => true },
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get Auth Type metadata (default: BEARER)
    const authTypes: AuthTypes[] = this.reflector.getAllAndOverride<AuthTypes[]>(AUTH_TYPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [AuthenticationGuard.defaultAuthType];

    // Flatten guards based on auth types
    const guards = authTypes.map((type) => this.authTypeGuardMap[type]).flat();

    if (!guards || guards.length === 0) {
      throw new UnauthorizedException('No authentication guard found');
    }

    // Execute authentication guards
    for (const guard of guards) {
      try {
        const result = await Promise.resolve(guard.canActivate(context));
        if (!result) {
          throw new UnauthorizedException('Authentication failed');
        }
      } catch (err) {
        throw err instanceof UnauthorizedException ? err : new UnauthorizedException();
      }
    }

    return true;
  }
}
