import { Module } from '@nestjs/common';

import { UsersController } from './users.controller';

// providers
import { UsersService } from './providers/users.service';
import { CreateUserProvider } from './providers/create-user.provider';
import { UpdateUserProvider } from './providers/update-user.provider';
import { FindUserProvider } from './providers/find-user.provider';
import { RemoveUserProvider } from './providers/remove-user.provider';

@Module({
  controllers: [UsersController],
  providers: [UsersService, CreateUserProvider, UpdateUserProvider, FindUserProvider, RemoveUserProvider],
})
export class UsersModule { }
