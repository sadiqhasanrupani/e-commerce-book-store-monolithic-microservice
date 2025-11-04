import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';

import { AUTH_PATTERNS } from '@app/contract/auth/patterns/auth.patterns';

@Injectable()
export class AuthService {
  constructor(
    /**
     * Adding clientproxy
     */
    @Inject('AUTH_CLIENT')
    private readonly client: ClientProxy
  ) {}

  register(createAuthDto: CreateAuthDto) {
    return this.client.send(AUTH_PATTERNS.REGISTER, createAuthDto);
  }

  findAll() {
    return `This action returns all auth`;
  }

  findOne(id: number) {
    return `This action returns a #${id} auth`;
  }

  update(id: number, updateAuthDto: UpdateAuthDto) {
    return `This action updates a #${id} auth`;
  }

  remove(id: number) {
    return `This action removes a #${id} auth`;
  }
}
