import { Injectable } from '@nestjs/common';

import { User } from '@app/contract/users/entities/user.entity';
import { CreateUserProvider } from './create-user.provider';
import { UpdateUserDto } from '@app/contract/users/dtos/update-user.dto';
import { FindUserProvider } from './find-user.provider';
import { CreateUserInput } from '@app/contract/users/types/create-user.type';

@Injectable()
export class UsersService {
  constructor(
    /**
     * Inject createUserProvider
     * */
    private readonly createUserProvider: CreateUserProvider,

    /**
     * Inject findUserProvider
     * */
    private readonly findUserProvider: FindUserProvider,
  ) {} //eslint-disable-line

  async create(createUserInput: CreateUserInput): Promise<User> {
    return this.createUserProvider.createUser(createUserInput);
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.findUserProvider.findByEmail(email);
  }

  findAll() {} //eslint-disable-line

  findOne(id: number) {} //eslint-disable-line

  update(id: number, updateUserDto: UpdateUserDto) {} //eslint-disable-line

  remove(id: number) {} //eslint-disable-line
}
