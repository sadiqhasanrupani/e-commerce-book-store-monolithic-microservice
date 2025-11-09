import { User } from '@app/contract/users/entities/user.entity';
import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class FindUserProvider {
  constructor(
    /**
     * Inject userRespository
     * */
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { } //eslint-disable-line

  async findByEmail(email: string): Promise<User | null> {
    try {
      const user = await this.userRepository.findOneBy({
        email: email,
      });

      return user;
    } catch (error: unknown) {
      let message = 'Something went wrong';

      if (error instanceof Error) {
        message = error.message;
      }

      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: message,
        },
        HttpStatus.BAD_REQUEST,
        {
          cause: error,
        },
      );
    }
  }

  async findAll() {
    try {
      const users = await this.userRepository.find();

      if (Array.isArray(users) && users.length === 0) {
        throw new NotFoundException(`User's storage are empty`);
      }

      return users;
    } catch (error: unknown) {
      let message = 'Something went wrong';

      if (error instanceof Error) {
        message = error.message;
      }

      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: message,
        },
        HttpStatus.BAD_REQUEST,
        {
          cause: error,
        },
      );
    }
  }

  async findById(id: number) {
    try {
      const users = await this.userRepository.findBy({
        id,
      });

      if (Array.isArray(users) && users.length === 0) {
        throw new NotFoundException(`The user with id ${id} doesn't exist`);
      }

      return users;
    } catch (error: unknown) {
      let message = 'Something went wrong';

      if (error instanceof Error) {
        message = error.message;
      }

      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: message,
        },
        HttpStatus.BAD_REQUEST,
        {
          cause: error,
        },
      );
    }
  }
}
