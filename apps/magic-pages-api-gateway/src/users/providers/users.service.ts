import { Injectable } from '@nestjs/common';

import { User } from '@app/contract/users/entities/user.entity';
import { CreateUserProvider } from './create-user.provider';
import { UpdateUserDto } from '@app/contract/users/dtos/update-user.dto';

import { FindUserProvider } from './find-user.provider';
import { UpdateUserProvider } from './update-user.provider';
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

    /**
     * Inject updateUserProvider
     * */
    private readonly updateUserProvider: UpdateUserProvider,
  ) { } //eslint-disable-line

  async create(createUserInput: CreateUserInput): Promise<User> {
    return this.createUserProvider.createUser(createUserInput);
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.findUserProvider.findByEmail(email);
  }

  findAll() { } //eslint-disable-line

  async findOne(id: number): Promise<User | null> {
    return this.findUserProvider.findOneById(id);
  }

  update(id: number, updateUserDto: UpdateUserDto) { } //eslint-disable-line

  remove(id: number) { } //eslint-disable-line


  async activateUser(id: number): Promise<User> {
    return this.updateUserProvider.activateUser(id);
  }
}
