import { Controller, Get, Post, Body, Patch, Param, Delete, ConflictException } from '@nestjs/common';
import { UsersService } from './providers/users.service';

import { CreateUserDto } from '@app/contract/users/dtos/create-user.dto';
import { UpdateUserDto } from '@app/contract/users/dtos/update-user.dto';
import { HashingProvider } from '../auth/providers/hashing.provider';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly hashingProvider: HashingProvider,
  ) { } //eslint-disable-line

  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    if (typeof createUserDto.password !== 'string') {
      throw new ConflictException();
    }

    const passwordHash = await this.hashingProvider.hashPassword(createUserDto.password);
    const newUser = this.usersService.create({
      email: createUserDto.email,
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      googleId: createUserDto.googleId,
      role: createUserDto.role,
      passwordHash,
    });

    return {
      message: 'User created sucessfully',
      newUser: newUser,
    };
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }
}
