import { CreateUserDto } from "@app/contract/users/dtos/create-user.dto";
import { User } from "@app/contract/users/entities/user.entity";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

@Injectable()
export class CreateUserProvider {
  constructor(
    /**
     * Inject userRepository
     * */
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createUser(createUserDto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create(createUserDto);

    return await this.userRepository.save(user);
  }
}
