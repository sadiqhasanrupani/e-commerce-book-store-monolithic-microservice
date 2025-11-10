import { SetMetadata } from '@nestjs/common';
import { ROLE_TYPE_KEY } from '@app/contract/auth/constants/auth.constant';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';

export const Role = (...authTypes: RoleTypes[]) => SetMetadata(ROLE_TYPE_KEY, authTypes);
