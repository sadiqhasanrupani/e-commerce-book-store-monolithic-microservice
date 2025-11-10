import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { RoleBaseAccessTokenGuard } from '../role-base-access-token/role-base-access-token.guard';
import { ROLE_TYPE_KEY } from '@app/contract/auth/constants/auth.constant';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  private static readonly defaultRoleType = RoleTypes.BUYER;

  private readonly roleTypeGuardMap: Record<RoleTypes, CanActivate | CanActivate[]>;

  constructor(
    private readonly reflector: Reflector,
    private readonly roleBaseAccessTokenGuard: RoleBaseAccessTokenGuard,
  ) {
    // Role-based guards (admin / buyer / none)
    this.roleTypeGuardMap = {
      [RoleTypes.ADMIN]: this.roleBaseAccessTokenGuard as CanActivate,
      [RoleTypes.BUYER]: this.roleBaseAccessTokenGuard as CanActivate,
      [RoleTypes.NONE]: { canActivate: () => true },
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get Role Type metadata (default: NONE)
    const roleTypes: RoleTypes[] = this.reflector.getAllAndOverride<RoleTypes[]>(ROLE_TYPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [AuthorizationGuard.defaultRoleType];

    // Flatten guards for role
    const guards = roleTypes.map((type) => this.roleTypeGuardMap[type]).flat();

    if (!guards || guards.length === 0) {
      throw new UnauthorizedException('No role guard found');
    }

    // Execute role-based guards
    for (const instance of guards) {
      try {
        const canActivate = await Promise.resolve(instance.canActivate(context));
        if (canActivate) {
          return true;
        }
      } catch (err: unknown) {
        if (err instanceof ForbiddenException || err instanceof UnauthorizedException) {
          throw err;
        }
        throw new ForbiddenException('Access denied for this role');
      }
    }

    // Fallback
    throw new UnauthorizedException('Invalid role access');
  }
}
