import { Roles } from '../enums/roles.enum';

export class CreateUserInput {
  email: string;
  passwordHash: string;
  googleId?: string;
  role?: Roles;
  firstName?: string;
  lastName?: string;
}
