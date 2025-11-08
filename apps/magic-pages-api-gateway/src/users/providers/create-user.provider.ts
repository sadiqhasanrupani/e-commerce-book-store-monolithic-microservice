import { CreateUserDto } from '@app/contract/users/dtos/create-user.dto';
import { User } from '@app/contract/users/entities/user.entity';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FindUserProvider } from './find-user.provider';
import { Roles } from '@app/contract/users/enums/roles.enum';
import { HashingProvider } from '../../auth/providers/hashing.provider';

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

    /**
     * Inject hashingProvider
     * */
    private readonly hashingProvider: HashingProvider,
  ) { } // eslint-disable-line

  async createUser(dto: CreateUserDto): Promise<User> {
    const existing = await this.findUserProvider.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    let passwordHash: string | null = null;
    if (!dto.googleId) {
      if (typeof dto.password === 'string' && dto.password.trim().length > 0) {
        passwordHash = await this.hashingProvider.hashPassword(dto.password);
      } else {
        throw new BadRequestException('Password is required for email signup');
      }
    }

    const user = this.userRepository.create({
      ...dto,
      passwordHash,
      googleId: dto.googleId ?? null,
      role: Roles.BUYER,
    });

    await this.userRepository.insert(user);
    return user;
  }
}
