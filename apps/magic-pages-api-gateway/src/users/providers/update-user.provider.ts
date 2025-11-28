import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@app/contract/users/entities/user.entity';
import { UserStatus } from '@app/contract/users/enums/user-status.enum';

@Injectable()
export class UpdateUserProvider {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }

  async activateUser(id: number): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.status = UserStatus.ACTIVE;
    user.emailVerifiedAt = new Date();
    return this.userRepository.save(user);
  }
}
