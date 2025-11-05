import { Module } from '@nestjs/common';

import { UsersService } from './providers/users.service.ts';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
