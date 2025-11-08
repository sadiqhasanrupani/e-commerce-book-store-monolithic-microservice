import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// providers
import { AuthModule } from '../auth/auth.module';

import { UsersController } from './users.controller';

// providers
import { UsersService } from './providers/users.service';
import { CreateUserProvider } from './providers/create-user.provider';
import { UpdateUserProvider } from './providers/update-user.provider';
import { FindUserProvider } from './providers/find-user.provider';
import { RemoveUserProvider } from './providers/remove-user.provider';

import { User } from '@app/contract/users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [UsersController],
  providers: [UsersService, CreateUserProvider, UpdateUserProvider, FindUserProvider, RemoveUserProvider],
  exports: [TypeOrmModule],
})
export class UsersModule { } //eslint-disable-line
