import { ConflictException, Inject, Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';

import jwtConfig from '@app/contract/auth/configs/jwt.config';

import { RegisterAuthDto } from '@app/contract/auth/dtos/register-auth.dto';
import { VerifyOtpDto } from '@app/contract/auth/dtos/verify-otp.dto';
import { AuthInput, SignInData } from '@app/contract/auth/types/validate-user.type';
import { AuthResult } from '@app/contract/auth/types/authenticate.type';

import { UsersService } from '../../users/providers/users.service';
import { HashingProvider } from './hashing.provider';
import { Roles } from '@app/contract/users/enums/roles.enum';
import { OtpService } from './otp.service';
import { RABBITMQ_CLIENT } from '@rmq/rmq/constants/rmq.constant';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { RegisterDto } from '@app/contract/auth/dtos/register.dto';

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
    private readonly otpService: OtpService,
    @Inject(RABBITMQ_CLIENT) private readonly rmqClient: ClientProxy,

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
  async register(registerDto: RegisterDto): Promise<{ message: string; userId: number; email: string }> {
    try {
      // 1. Destructure fullName and role (if it exists on DTO)
      const { email, password, fullName } = registerDto;

      console.log('[AuthService] Starting registration for:', email);

      // --- NAME SPLITTING LOGIC ---
      // Split by one or more spaces to handle accidental double spaces
      const nameParts = fullName.trim().split(/\s+/);

      // First name is always the first part
      const firstName = nameParts[0];

      // Last name is the last part (if more than 1 part exists)
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

      // Middle name is everything between the first and last index (if more than 2 parts exist)
      const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';
      // ----------------------------

      // Check for existing user
      const existingUser = await this.usersService.findByEmail(email);
      if (existingUser) {
        throw new ConflictException(`User with email ${email} already exists`);
      }
      console.log('[AuthService] User does not exist, proceeding...');

      // Validate and hash password (Optional: DTO usually handles validation, but this is a safe double-check)
      if (typeof password !== 'string' || password.trim().length < 6) {
        throw new BadRequestException('Password must be at least 6 characters long');
      }

      console.log('[AuthService] Hashing password...');
      const passwordHash = await this.hashingProvider.hashPassword(password);

      // Create user record in DB
      console.log('[AuthService] Creating user in database...');
      const newUser = await this.usersService.create({
        email,
        passwordHash,
        firstName,
        lastName,
        middleName,
        role: Roles.BUYER,
      });

      console.log('[AuthService] User created with ID:', newUser.id);

      // Generate OTP
      console.log('[AuthService] Generating OTP...');
      const otp = await this.otpService.generateAndSaveOtp(newUser, 'REGISTRATION');

      // Publish event
      console.log('[AuthService] Emitting email verification event...');
      this.rmqClient.emit('email_verification.requested', {
        userId: newUser.id,
        email: newUser.email,
        otp,
        name: newUser.firstName, // Or use 'fullName' if you prefer addressing them by full name
      });

      return {
        message: 'User registered successfully. Please check your email for verification code.',
        userId: newUser.id,
        email: newUser.email,
      };
    } catch (error) {
      console.error('[AuthService] Registration error:', error);
      throw error;
    }
  }

  async verifyRegistration(verifyOtpDto: VerifyOtpDto): Promise<AuthResult> {
    const { email, otp } = verifyOtpDto;
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new BadRequestException('Invalid email or OTP');
    }

    const isValid = await this.otpService.verifyOtp(user.email, otp, 'REGISTRATION');
    if (!isValid) {
      throw new BadRequestException('Invalid email or OTP');
    }

    await this.usersService.activateUser(user.id);

    return this.signIn({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
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
      audience: this.jwtConfiguration.audience,
      expiresIn: this.jwtConfiguration.accessTokenTtl,
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

  /**
   * Request OTP for passwordless login
   * Sends OTP to user's email for authentication
   */
  async requestLoginOtp(email: string): Promise<{ message: string; email: string }> {
    // Check if user exists and is verified
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Please verify your email first');
    }

    // Generate OTP for LOGIN
    const otp = await this.otpService.generateAndSaveOtp(user, 'LOGIN');

    // Emit email event
    this.rmqClient.emit('email_verification.requested', {
      userId: user.id,
      email: user.email,
      otp,
      name: user.firstName,
    });

    return {
      message: 'OTP sent to your email. Please check your inbox.',
      email: user.email,
    };
  }

  /**
   * Verify OTP and login (passwordless)
   * Returns JWT token upon successful OTP verification
   */
  async verifyLoginOtp(email: string, otp: string): Promise<AuthResult> {
    // Verify OTP
    const isValid = await this.otpService.verifyOtp(email, otp, 'LOGIN');
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // Get user
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Generate JWT token
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      {
        audience: this.jwtConfiguration.audience,
        issuer: this.jwtConfiguration.issuer,
        secret: this.jwtConfiguration.secret,
        expiresIn: this.jwtConfiguration.accessTokenTtl,
      },
    );

    return {
      accessToken,
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  }

  /**
   * @method getMe
   * @description
   * Retrieves the current authenticated user's profile.
   *
   * @param userId - The ID of the authenticated user
   * @throws {NotFoundException} if user not found
   * @returns {Promise<User>} - The user entity
   */
  async getMe(userId: number) {
    const user = await this.usersService.findOne(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}
