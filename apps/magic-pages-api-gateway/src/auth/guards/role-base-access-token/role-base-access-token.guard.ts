import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { ROLE_TYPE_KEY } from '@app/contract/auth/constants/auth.constant';

import { JwtPayload } from '@app/contract/auth/types/jwt-payload.type';
import { AuthenticatedRequest } from '@app/contract/auth/interfaces/authenticated-request.interface';

@Injectable()
export class RoleBaseAccessTokenGuard implements CanActivate {
  private static readonly defaultRoleType = RoleTypes.NONE;
  constructor(private readonly reflector: Reflector) { } // eslint-disable-line

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Get the user object attached by AuthenticationGuard
    const user = request.user as JwtPayload;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get allowed roles from metadata
    const allowedRoles: RoleTypes[] = this.reflector.getAllAndOverride<RoleTypes[]>(ROLE_TYPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [RoleBaseAccessTokenGuard.defaultRoleType];

    // If route allows NONE role, allow access
    if (allowedRoles.includes(RoleTypes.NONE)) {
      return true;
    }

    // Check if user role matches allowed roles
    if (!allowedRoles.includes(user.role as unknown as RoleTypes)) {
      throw new ForbiddenException('Access denied for this role');
    }

    return true;
  }
}
