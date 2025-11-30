import { Expose } from 'class-transformer';
import { Roles } from '../enums/roles.enum';
import { UserStatus } from '../enums/user-status.enum';

export class MeResponseDto {
  @Expose()
  id: number;

  @Expose()
  email: string;

  @Expose()
  firstName: string;

  @Expose()
  lastName: string;

  @Expose()
  role: Roles;

  @Expose()
  status: UserStatus;
}
