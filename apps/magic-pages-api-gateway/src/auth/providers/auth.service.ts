import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';

import jwtConfig from '@app/contract/auth/configs/jwt.config';

import { VerifyOtpDto } from '@app/contract/auth/dtos/verify-otp.dto';
import { AuthInput, SignInData } from '@app/contract/auth/types/validate-user.type';
import { AuthResult } from '@app/contract/auth/types/authenticate.type';
import { AuthErrorCode } from '@app/contract/auth/enums/auth-error-code.enum';

import { UsersService } from '../../users/providers/users.service';
import { HashingProvider } from './hashing.provider';
import { Roles } from '@app/contract/users/enums/roles.enum';
import { UserStatus } from '@app/contract/users/enums/user-status.enum';
import { User } from '@app/contract/users/entities/user.entity';
import { OtpService } from './otp.service';
import { RABBITMQ_CLIENT } from '@rmq/rmq/constants/rmq.constant';
import { ClientProxy } from '@nestjs/microservices';
import { RegisterDto } from '@app/contract/auth/dtos/register.dto';

/**
 * Options accepted by {@link AuthService.authenticate}.
 */
export type AuthenticateOptions = {
  /**
   * Skip the email-verification gate.
   *
   * SECURITY: this must stay `false` for every storefront/customer login path.
   * The only sanctioned caller passing `true` is the internal admin/CRM login
   * (`AuthAdminController`), whose accounts are provisioned out-of-band and may
   * legitimately never have gone through the customer OTP flow.
   */
  allowUnverifiedEmail?: boolean;
};

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
  private readonly logger = new Logger(AuthService.name);

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
   * If valid AND the account has completed email verification, returns a signed
   * JWT access token.
   *
   * @param input - The authentication payload (email, password)
   * @param options - See {@link AuthenticateOptions}. Storefront callers must not pass
   *                  `allowUnverifiedEmail`.
   * @throws {UnauthorizedException} `INVALID_CREDENTIALS` — unknown email or wrong password
   * @throws {ForbiddenException} `EMAIL_NOT_VERIFIED` — correct password, unverified account
   * @throws {ForbiddenException} `ACCOUNT_NOT_ACTIVE` — suspended/deleted account
   * @throws {ConflictException} `PASSWORD_NOT_SET` — account has no password (social login)
   * @returns {Promise<AuthResult>} - JWT token and user info
   */
  async authenticate(input: AuthInput, options: AuthenticateOptions = {}): Promise<AuthResult> {
    const user = await this.validateCredentials(input);

    if (!options.allowUnverifiedEmail) {
      this.assertLoginAllowed(user);
    }

    return this.signIn(this.toSignInData(user));
  }

  /**
   * @method validateCredentials
   * @description
   * Verifies the email/password pair ONLY. Deliberately says nothing about the
   * account's verification status — that is {@link assertLoginAllowed}'s job, and it
   * must run *after* this so we never disclose account state to someone who did not
   * supply the correct password.
   *
   * @param input - The authentication data containing email and password
   * @throws {UnauthorizedException} `INVALID_CREDENTIALS` if user not found or password mismatch
   * @throws {ConflictException} `PASSWORD_NOT_SET` if the account has no password hash
   * @returns {Promise<User>} - The matched user entity
   */
  private async validateCredentials(input: AuthInput): Promise<User> {
    const user = await this.usersService.findByEmail(input.email);

    // Identical error for "no such user" and "wrong password": returning a
    // distinguishable response here would turn sign-in into an email-enumeration oracle.
    const invalidCredentials = () =>
      new UnauthorizedException({
        code: AuthErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      });

    if (!user) {
      throw invalidCredentials();
    }

    if (!user.passwordHash) {
      throw new ConflictException({
        code: AuthErrorCode.PASSWORD_NOT_SET,
        message: 'This account has no password set. Please sign in with the method you originally used.',
      });
    }

    const isPasswordValid = await this.hashingProvider.comparePassword(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw invalidCredentials();
    }

    return user;
  }

  /**
   * @method assertLoginAllowed
   * @description
   * The email-verification gate. Central choke point: every path that issues a JWT for
   * an existing account runs this, so a user who never completed the registration OTP
   * cannot obtain a token by any route.
   *
   * A user row is considered verified when `status = ACTIVE`. `emailVerifiedAt` is set
   * at the same moment by `UpdateUserProvider.activateUser`, and is checked as a
   * belt-and-braces guard against rows activated by a manual SQL update.
   *
   * @param user - The user entity being logged in
   * @throws {ForbiddenException} `EMAIL_NOT_VERIFIED` while the account is still PENDING
   * @throws {ForbiddenException} `ACCOUNT_NOT_ACTIVE` for suspended/deleted accounts
   */
  private assertLoginAllowed(user: User): void {
    console.log(`[auth.service]::${Date.now()}::user detail::`, user);

    if (user.status === UserStatus.PENDING || !user.emailVerifiedAt) {
      this.logger.warn(`Blocked sign-in for unverified account (userId=${user.id})`);

      throw new ForbiddenException({
        code: AuthErrorCode.EMAIL_NOT_VERIFIED,
        message: 'Please verify your email address before signing in. Check your inbox for the verification code.',
        // Echoed back so the storefront can jump straight to the OTP screen
        // without asking the user to retype their address.
        email: user.email,
      });
    }

    if (user.status !== UserStatus.ACTIVE || user.isDeleted) {
      this.logger.warn(`Blocked sign-in for inactive account (userId=${user.id}, status=${user.status})`);

      throw new ForbiddenException({
        code: AuthErrorCode.ACCOUNT_NOT_ACTIVE,
        message: 'This account is not active. Please contact support.',
      });
    }
  }

  /** Narrows a `User` entity down to the claims we put in the JWT. */
  private toSignInData(user: User): SignInData {
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

      // Validate and hash password (Optional: DTO usually handles validation, but this is a safe double-check)
      if (typeof password !== 'string' || password.trim().length < 6) {
        throw new BadRequestException('Password must be at least 6 characters long');
      }

      const passwordHash = await this.hashingProvider.hashPassword(password);

      // Create user record in DB. Note: `users.status` defaults to PENDING and
      // `email_verified_at` stays NULL until the OTP is verified — that is exactly
      // what `assertLoginAllowed` gates on.
      const newUser = await this.usersService.create({
        email,
        passwordHash,
        firstName,
        lastName,
        middleName,
        role: Roles.BUYER,
      });

      this.logger.log(`Registered new user (userId=${newUser.id}), awaiting email verification`);

      // Generate OTP
      const otp = await this.otpService.generateAndSaveOtp(newUser, 'REGISTRATION');

      // Publish the "send the OTP email" event.
      this.publishVerificationEmail({
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
      this.logger.error(`Registration failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw error;
    }
  }

  /**
   * @method publishVerificationEmail
   * @description
   * Publishes `email_verification.requested` onto RabbitMQ for `EmailConsumer` to pick up.
   *
   * Fire-and-forget by design — a broker hiccup must not fail an otherwise successful
   * registration — but NOT silent. `ClientProxy.emit()` returns a connectable Observable;
   * with nobody subscribed, a publish failure is swallowed with no trace whatsoever, which
   * is a large part of why the missing OTP emails went unnoticed. Subscribing purely for
   * the error channel keeps the async behaviour and gives us a log line when it breaks.
   *
   * The OTP itself is never logged.
   */
  private publishVerificationEmail(payload: { userId: number; email: string; otp: string; name?: string }): void {
    this.rmqClient.emit('email_verification.requested', payload).subscribe({
      error: (error: unknown) => {
        this.logger.error(
          `Failed to publish email_verification.requested for userId=${payload.userId}: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          `The user will not receive their OTP — check RABBITMQ_URL and broker health.`,
        );
      },
    });
  }

  async verifyRegistration(verifyOtpDto: VerifyOtpDto): Promise<AuthResult> {
    const { email, otp } = verifyOtpDto;
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new BadRequestException('Invalid email or OTP');
    }

    const isValid = await this.otpService.verifyOtp(user.email, otp, 'REGISTRATION');
    if (!isValid) {
      throw new BadRequestException({
        code: AuthErrorCode.INVALID_OTP,
        message: 'Invalid email or OTP',
      });
    }

    // Flips status PENDING -> ACTIVE and stamps email_verified_at. This is the ONLY
    // path that clears the `assertLoginAllowed` gate for a customer account.
    const activatedUser = await this.usersService.activateUser(user.id);

    this.logger.log(`Email verified for userId=${activatedUser.id}`);

    return this.signIn(this.toSignInData(activatedUser));
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
      throw new UnauthorizedException({
        code: AuthErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      });
    }

    // Same gate as password sign-in, so passwordless login cannot be used to
    // sidestep email verification.
    this.assertLoginAllowed(user);

    // Generate OTP for LOGIN
    const otp = await this.otpService.generateAndSaveOtp(user, 'LOGIN');

    // Emit email event
    this.publishVerificationEmail({
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
      throw new UnauthorizedException({
        code: AuthErrorCode.INVALID_OTP,
        message: 'Invalid or expired OTP',
      });
    }

    // Get user
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException({
        code: AuthErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      });
    }

    // A LOGIN-purpose OTP is only ever issued to a verified account, but re-assert here
    // so this method is safe on its own terms — it is a token-issuing entry point.
    this.assertLoginAllowed(user);

    // Route through the shared signIn() so there is exactly one JWT-issuing code path.
    return this.signIn(this.toSignInData(user));
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
