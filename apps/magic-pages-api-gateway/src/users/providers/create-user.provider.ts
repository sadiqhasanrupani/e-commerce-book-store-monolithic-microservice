import { CreateUserDto } from '@app/contract/users/dtos/create-user.dto';
import { User } from '@app/contract/users/entities/user.entity';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class CreateUserProvider {
  constructor(
    /**
     * Inject userRepository
     * */
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { } // eslint-disable-line

  async createUser(createUserDto: CreateUserDto): Promise<User> {
    // Check if that email already registered
    // Check if the payload contains googleId
    // If googleId present then redirect to created with google user service
    // If not Bcrypt the password
    // Save the user with default role as Buyer

    const user = this.userRepository.create(createUserDto);
    return await this.userRepository.save(user);
  }
}
