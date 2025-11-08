import bcrypt from 'bcrypt';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HashingProvider } from './hashing.provider';

@Injectable()
export class BcryptProvider implements HashingProvider {
  public async hashPassword(data: string | Buffer): Promise<string> {
    try {
      const salt: string = await bcrypt.genSalt(8); // eslint-disable-line
      return await bcrypt.hash(data.toString(), salt); // eslint-disable-line
    } catch (err: unknown) {
      if (err instanceof Error) {
        // safe access of err.message
        throw new InternalServerErrorException(`Password hashing failed: ${err.message}`, { cause: err });
      }
      throw new InternalServerErrorException('Unexpected error while hashing password');
    }
  }

  public async comparePassword(data: string | Buffer, encrypted: string): Promise<boolean> {
    try {
      return await bcrypt.compare(data, encrypted); // eslint-disable-line
    } catch (err: unknown) {
      if (err instanceof Error) {
        throw new InternalServerErrorException(`Password comparison failed: ${err.message}`, { cause: err });
      }
      throw new InternalServerErrorException('Unexpected error while comparing password');
    }
  }
}
