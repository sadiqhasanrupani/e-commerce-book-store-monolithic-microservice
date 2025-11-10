import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HashingProvider } from './hashing.provider';

// Import argon2 using a typed import instead of a namespace import
// This fixes eslint's "unsafe assignment" issues
import { Options as Argon2Options, argon2id, verify, hash } from 'argon2';

/**
 * Argon2-based hashing provider for secure password storage.
 * Dynamically configured using environment variables.
 */
@Injectable()
export class Argon2Provider implements HashingProvider {
  private readonly options: Argon2Options;

  constructor(private readonly configService: ConfigService) {
    this.options = {
      type: argon2id,
      memoryCost: this.configService.get<number>('ARGON2_MEMORY_COST', 65536),
      timeCost: this.configService.get<number>('ARGON2_TIME_COST', 5),
      parallelism: this.configService.get<number>('ARGON2_PARALLELISM', 2),
    };
  }

  /**
   * Hash the given plaintext using Argon2id.
   */
  public async hashPassword(data: string | Buffer): Promise<string> {
    try {
      const input = data instanceof Buffer ? data.toString('utf8') : data;
      const hashed = await hash(input, this.options);

      if (typeof hashed !== 'string') {
        throw new Error('Unexpected hash output type');
      }

      return hashed;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new InternalServerErrorException(`Password hashing failed: ${message}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  /**
   * Verify that the given plaintext matches the stored hash.
   */
  public async comparePassword(data: string | Buffer, encrypted: string): Promise<boolean> {
    try {
      const input = data instanceof Buffer ? data.toString('utf8') : data;
      const isValid = await verify(encrypted, input);

      if (typeof isValid !== 'boolean') {
        throw new Error('Unexpected verification result type');
      }

      return isValid;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new InternalServerErrorException(`Password comparison failed: ${message}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
