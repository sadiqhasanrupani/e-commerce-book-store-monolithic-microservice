import { Roles } from '@app/contract/users/enums/roles.enum';

export type AuthResult = {
  accessToken: string;
  userId: number;
  email: string;
  role: Roles;
};
