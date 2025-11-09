import { ConflictException, Inject, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';

import jwtConfig from '@app/contract/auth/configs/jwt.config';

import { RegisterAuthDto } from '@app/contract/auth/dtos/register-auth.dto';
import { AuthInput, SignInData } from '@app/contract/auth/types/validate-user.type';
import { AuthResult } from '@app/contract/auth/types/authenticate.type';

import { UsersService } from '../../users/providers/users.service';
import { HashingProvider } from './hashing.provider';
import { Roles } from '@app/contract/users/enums/roles.enum';

/**
 * @class AuthService
 * @description
 * The `AuthService` handles user registration, authentication,
 * and JWT token issuance for the Magic Pages e-commerce platform.
 *
 * Responsibilities:
 * - User validation and credential checks
 * - Secure password hashing and verification
 * - JWT token generation for sessions
 * - Registration of new users with role-based assignment
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly hashingProvider: HashingProvider,
    private readonly jwtService: JwtService,

    @Inject(jwtConfig.KEY)
    private readonly jwtConfiguration: ConfigType<typeof jwtConfig>,
  ) { } // eslint-disable-line

  /**
   * @method authenticate
   * @description
   * Authenticates a user using email and password credentials.
   * If valid, returns a signed JWT access token.
   *
   * @param input - The authentication payload (email, password)
   * @returns {Promise<AuthResult>} - JWT token and user info
   */
  async authenticate(input: AuthInput): Promise<AuthResult> {
    const user = await this.validateUser(input);
    return this.signIn(user);
  }

  /**
   * @method validateUser
   * @description
   * Validates user credentials by verifying email and password.
   *
   * @param input - The authentication data containing email and password
   * @throws {UnauthorizedException} if user not found or password mismatch
   * @returns {Promise<SignInData>} - Validated user details
   */
  private async validateUser(input: AuthInput): Promise<SignInData> {
    const user = await this.usersService.findByEmail(input.email);

    if (!user) {
      throw new UnauthorizedException(`Invalid credentials for email: ${input.email}`);
    }

    if (!user.passwordHash) {
      throw new ConflictException(`Password not set for user with email: ${input.email}`);
    }

    const isPasswordValid = await this.hashingProvider.comparePassword(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException(`Incorrect password for email: ${input.email}`);
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  }

  /**
   * @method register
   * @description
   * Registers a new user in the system after validating uniqueness and securely hashing their password.
   *
   * Steps:
   *  1. Validate if user already exists
   *  2. Hash password using configured hashing algorithm
   *  3. Persist new user in the database
   *  4. Issue a JWT access token
   *
   * @param registerDto - The user registration payload
   * @throws {ConflictException} if user already exists
   * @throws {BadRequestException} if password is invalid
   * @returns {Promise<AuthResult>} - JWT access token and user details
   */
  async register(registerDto: RegisterAuthDto): Promise<AuthResult> {
    const { email, password, firstName, lastName, role } = registerDto;

    // 1️⃣ Check for existing user
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new ConflictException(`User with email ${email} already exists`);
    }

    // 2️⃣ Validate and hash password
    if (typeof password !== 'string' || password.trim().length < 6) {
      throw new BadRequestException('Password must be at least 6 characters long');
    }

    const passwordHash = await this.hashingProvider.hashPassword(password);

    // 3️⃣ Create user record in DB
    const newUser = await this.usersService.create({
      email,
      passwordHash,
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      role: role ?? Roles.BUYER,
    });

    // 4️⃣ Issue access token
    const payload = {
      sub: newUser.id,
      email: newUser.email,
      role: newUser.role,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.jwtConfiguration.secret,
      issuer: this.jwtConfiguration.issuer,
    });

    // 5️⃣ Return registration response
    return {
      accessToken,
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
    };
  }

  /**
   * @method signIn
   * @description
   * Issues a JWT token for an already authenticated user.
   *
   * @param user - The validated user details
   * @returns {Promise<AuthResult>} - JWT access token with user info
   */
  private async signIn(user: SignInData): Promise<AuthResult> {
    const payload = {
      sub: user.userId,
      ...user,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.jwtConfiguration.secret,
      issuer: this.jwtConfiguration.issuer,
    });

    return {
      accessToken,
      ...user,
    };
  }

  /**
   * Logout user by blacklisting their active JWT token.
   * @param token - The access token (JWT) from request header
   * @param userId - The user’s ID
   */
  // async logout(token: string, userId: number): Promise<{ message: string }> {
  //   try {
  //     if (!token) throw new BadRequestException('Token is required for logout');
  //
  //     // Extract token’s expiry time
  //     const decoded = this.jwtService.decode(token);
  //     if (!decoded || !decoded.exp) {
  //       throw new BadRequestException('Invalid token structure');
  //     }
  //
  //     const expiresInMs = decoded.exp * 1000 - Date.now();
  //
  //     // Add token to Redis blacklist with TTL until expiry
  //     await this.redisService.set(`blacklist:${token}`, 'revoked', {
  //       ttl: Math.max(1, expiresInMs / 1000), // seconds
  //     });
  //
  //     return { message: `User ${userId} logged out successfully` };
  //   } catch (err) {
  //     throw new InternalServerErrorException(`Logout failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  //   }
  // }

  /**
   * Check if a JWT token is blacklisted (revoked).
   * Can be used in a guard or interceptor.
   */
  // async isTokenBlacklisted(token: string): Promise<boolean> {
  //   const result = await this.redisService.get(`blacklist:${token}`);
  //   return !!result;
  // }
}
