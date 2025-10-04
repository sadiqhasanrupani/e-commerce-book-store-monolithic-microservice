import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

import { USER_PATTERNS } from '@app/contract/users/patterns/users.pattern';

@Injectable()
export class UsersService {
  constructor(
    /**
     * Injecting userClient proxy
     * */
    @Inject('USER_CLIENT')
    private readonly userClient: ClientProxy,
  ) { }

  create(createUserDto: CreateUserDto) {
    return this.userClient.send(USER_PATTERNS.CREATE, createUserDto);
  }

  findAll() {
    return this.userClient.send(USER_PATTERNS.FIND_ALL, {});
  }

  findOne(id: number) {
    return this.userClient.send(USER_PATTERNS.FIND_ONE, id);
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return this.userClient.send(USER_PATTERNS.UPDATE, { id, ...updateUserDto });
  }

  remove(id: number) {
    return this.userClient.send(USER_PATTERNS.DELETE, id);
  }
}
