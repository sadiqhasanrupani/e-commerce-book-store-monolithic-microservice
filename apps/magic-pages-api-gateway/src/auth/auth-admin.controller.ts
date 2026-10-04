
import { Controller, Post, Body, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './providers/auth.service';
import { SignInDto } from '@app/contract/auth/dtos/sign-in.dto';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { Auth } from './decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from './decorator/role.decorator';

import { Roles } from '@app/contract/users/enums/roles.enum';

@ApiTags('Auth Admin')
@Controller('admin/auth')
export class AuthAdminController {
  constructor(private readonly authService: AuthService) { }

  @Post('login')
  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Admin Login' })
  @ApiResponse({ status: 201, description: 'Admin authenticated successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. User is not an admin.' })
  async login(@Body() signInDto: SignInDto) {
    // SECURITY / SCOPE NOTE: the customer email-OTP verification gate is deliberately
    // bypassed here. Admin accounts are provisioned out-of-band (seed/manual insert) and
    // never go through the storefront registration OTP flow, so gating this path would
    // lock the CRM out. This exemption is intentionally explicit and greppable — see
    // internal-docs/eng-log/2026-08-25-gate-login-on-email-verification.code-changes.md
    // for the follow-up to give admins their own provisioning + verification story.
    const result = await this.authService.authenticate(signInDto, { allowUnverifiedEmail: true });

    // Explicit cast or just logic check. result.role is likely 'string' or 'Roles'. 
    if ((result.role as any) !== Roles.ADMIN) {
      // Technically, we could return a 403 here. 
      // Ideally, we shouldn't even reveal that the credentials were correct if not admin?
      // But for this internal admin panel, 403 is clearer.
      throw new ForbiddenException('Access denied. Admins only.');
    }

    return result;
  }
}
