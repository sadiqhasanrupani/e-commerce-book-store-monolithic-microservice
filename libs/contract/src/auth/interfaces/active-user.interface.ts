import { Roles } from '@app/contract/users/enums/roles.enum';

export interface IActiveUser {
  sub: number;
  email: string;
  role: Roles;
  userId: number;
}
