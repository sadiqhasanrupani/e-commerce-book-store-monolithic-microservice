import { Roles } from '@app/contract/users/enums/roles.enum';

export type AuthInput = {
  email: string;
  password: string;
};

export type SignInData = {
  userId: number;
  email: string;
  role: Roles;
};
