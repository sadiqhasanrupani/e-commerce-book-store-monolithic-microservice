import { User } from '@app/contract/users/entities/user.entity';
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FindUserProvider } from './find-user.provider';
import { Roles } from '@app/contract/users/enums/roles.enum';
import { CreateUserInput } from '@app/contract/users/types/create-user.type';

@Injectable()
export class CreateUserProvider {
  constructor(
    /**
     * Inject userRepository
     * */
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    /**
     * Inject findUserProvider
     * */
    private readonly findUserProvider: FindUserProvider,
  ) {} // eslint-disable-line

  async createUser(input: CreateUserInput): Promise<User> {
    const existing = await this.findUserProvider.findByEmail(input.email);
    if (existing) throw new ConflictException('Email already registered');

    const user = this.userRepository.create({
      ...input,
      passwordHash: input.passwordHash,
      googleId: input.googleId ?? null,
      role: input.role ?? Roles.BUYER,
    });

    await this.userRepository.insert(user);
    return user;
  }
}
