import { Injectable } from '@nestjs/common';

import { CreateUserDto } from '@app/contract/users/dtos/create-user.dto';
import { User } from '@app/contract/users/entities/user.entity';
import { CreateUserProvider } from './create-user.provider';
import { UpdateUserDto } from '@app/contract/users/dtos/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    /**
     * Inject createUserProvider
     * */
    private readonly createUserProvider: CreateUserProvider,
  ) { } //eslint-disable-line

  async create(createUserDto: CreateUserDto): Promise<User> {
    return this.createUserProvider.createUser(createUserDto);
  }

  findAll() { } //eslint-disable-line

  findOne(id: number) { } //eslint-disable-line

  update(id: number, updateUserDto: UpdateUserDto) { } //eslint-disable-line

  remove(id: number) { } //eslint-disable-line
}
