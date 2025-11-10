import { registerAs } from '@nestjs/config';

/**
 * @configs related to hashing algorithms
 *
 * Supports switching between bcrypt and argon2 via environment variable.
 * Example:
 *   HASH_ALGO=argon2
 *   BCRYPT_SALT_ROUNDS=10
 *   ARGON2_MEMORY_COST=65536
 *   ARGON2_TIME_COST=5
 *   ARGON2_PARALLELISM=2
 */

export default registerAs('hash', () => ({
  /**
   * Algorithm selection
   * Possible values: 'bcrypt' | 'argon2'
   */
  algorithm: process.env.HASH_ALGO ?? 'bcrypt',

  /**
   * Configuration for bcrypt
   */
  bcrypt: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '10', 10),
  },

  /**
   * Configuration for argon2
   */
  argon2: {
    memoryCost: parseInt(process.env.ARGON2_MEMORY_COST ?? '65536', 10), // 64MB
    timeCost: parseInt(process.env.ARGON2_TIME_COST ?? '5', 10),
    parallelism: parseInt(process.env.ARGON2_PARALLELISM ?? '2', 10),
  },
}));
