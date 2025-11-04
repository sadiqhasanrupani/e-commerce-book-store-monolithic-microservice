import { Injectable } from '@nestjs/common';
import { CreateUserDto } from '@app/contract/users/dtos/create-user.dto';
import { UpdateUserDto } from '@app/contract/users/dtos/update-user.dto';

import { User } from '@app/contract/users/entities/user.entity';

@Injectable()
export class UsersService {
  create(createUserDto: CreateUserDto) {
    return 'This action adds a new user';
  }

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
