import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { REQUEST_USER_KEY } from '@app/contract/auth/constants/auth.constant';
import { IActiveUser } from '@app/contract/auth/interfaces/active-user.interface';

export const ActiveUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): IActiveUser => {
    const request = ctx.switchToHttp().getRequest();
    return request[REQUEST_USER_KEY];
  },
);
