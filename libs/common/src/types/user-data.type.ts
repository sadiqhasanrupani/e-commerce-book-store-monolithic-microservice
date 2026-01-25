import { RoleTypes } from "@app/contract/auth/enums/role-types.enum";

export interface UserData {
  sub: number;
  userId: number;
  email: string;
  role: RoleTypes,
  iat: number;
  exp: number;
  aud: string;
  iss: string;
}
