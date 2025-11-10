import { Roles } from '@app/contract/users/enums/roles.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Roles;
  iat?: number;
  exp?: number;
  [key: string]: unknown; // to allow custom claims safely
}
