import { SetMetadata } from '@nestjs/common';
import { AUTH_TYPE_KEY } from '@app/contract/auth/constants/auth.constant';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';

export const Auth = (...authTypes: AuthTypes[]) => SetMetadata(AUTH_TYPE_KEY, authTypes);
