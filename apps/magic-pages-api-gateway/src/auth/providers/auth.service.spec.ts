import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, ForbiddenException, HttpException, Logger, UnauthorizedException } from '@nestjs/common';
import { of, throwError } from 'rxjs';

import jwtConfig from '@app/contract/auth/configs/jwt.config';
import { AuthErrorCode } from '@app/contract/auth/enums/auth-error-code.enum';
import { User } from '@app/contract/users/entities/user.entity';
import { Roles } from '@app/contract/users/enums/roles.enum';
import { UserStatus } from '@app/contract/users/enums/user-status.enum';
import { RegisterDto } from '@app/contract/auth/dtos/register.dto';
import { RABBITMQ_CLIENT } from '@rmq/rmq/constants/rmq.constant';

import { AuthService } from './auth.service';
import { HashingProvider } from './hashing.provider';
import { OtpService } from './otp.service';
import { UsersService } from '../../users/providers/users.service';

const ACCESS_TOKEN = 'signed.jwt.token';
const PASSWORD = 'Correct-Horse-1!';

/** A fully verified, active customer. */
const verifiedUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 11,
    email: 'reader@example.com',
    passwordHash: 'hashed-password',
    role: Roles.BUYER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-08-20T09:00:00.000Z'),
    isDeleted: false,
    firstName: 'Reader',
    ...overrides,
  }) as unknown as User;

/** A valid registration payload. */
const registerPayload = (overrides: Partial<RegisterDto> = {}): RegisterDto => ({
  email: 'reader@example.com',
  password: PASSWORD,
  fullName: 'Reader Of Books',
  ...overrides,
});

/** A user who registered but never entered the OTP — the bug this suite guards. */
const unverifiedUser = (overrides: Partial<User> = {}): User =>
  verifiedUser({ status: UserStatus.PENDING, emailVerifiedAt: undefined, ...overrides });

describe('AuthService', () => {
  let service: AuthService;

  const usersService = {
    findByEmail: jest.fn(),
    create: jest.fn(),
    activateUser: jest.fn(),
    findOne: jest.fn(),
  };
  const hashingProvider = {
    comparePassword: jest.fn(),
    hashPassword: jest.fn(),
  };
  const jwtService = { signAsync: jest.fn() };
  const otpService = {
    generateAndSaveOtp: jest.fn(),
    verifyOtp: jest.fn(),
  };
  const rmqClient = { emit: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    jwtService.signAsync.mockResolvedValue(ACCESS_TOKEN);
    hashingProvider.comparePassword.mockResolvedValue(true);
    rmqClient.emit.mockReturnValue(of(undefined));

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: HashingProvider, useValue: hashingProvider },
        { provide: JwtService, useValue: jwtService },
        { provide: OtpService, useValue: otpService },
        { provide: RABBITMQ_CLIENT, useValue: rmqClient },
        {
          provide: jwtConfig.KEY,
          useValue: { secret: 'test-secret', audience: 'test-aud', issuer: 'test-iss', accessTokenTtl: 3600 },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  /**
   * The reported security gap: an account that never completed OTP verification could
   * sign in with email + password and receive a JWT.
   */
  describe('authenticate — email verification gate', () => {
    it('rejects a PENDING (unverified) user with 403 EMAIL_NOT_VERIFIED even when the password is correct', async () => {
      usersService.findByEmail.mockResolvedValue(unverifiedUser());

      const promise = service.authenticate({ email: 'reader@example.com', password: PASSWORD });

      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toMatchObject({
        response: {
          code: AuthErrorCode.EMAIL_NOT_VERIFIED,
          email: 'reader@example.com',
        },
      });
    });

    it('issues no JWT for an unverified user', async () => {
      usersService.findByEmail.mockResolvedValue(unverifiedUser());

      await expect(service.authenticate({ email: 'reader@example.com', password: PASSWORD })).rejects.toThrow();

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects a user whose status is ACTIVE but has no emailVerifiedAt stamp', async () => {
      // Guards against a row flipped to ACTIVE by a manual SQL update that skipped the OTP flow.
      usersService.findByEmail.mockResolvedValue(verifiedUser({ emailVerifiedAt: undefined }));

      await expect(service.authenticate({ email: 'reader@example.com', password: PASSWORD })).rejects.toMatchObject({
        response: { code: AuthErrorCode.EMAIL_NOT_VERIFIED },
      });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('accepts a verified ACTIVE user and returns an access token', async () => {
      usersService.findByEmail.mockResolvedValue(verifiedUser());

      const result = await service.authenticate({ email: 'reader@example.com', password: PASSWORD });

      expect(result).toEqual({
        accessToken: ACCESS_TOKEN,
        userId: 11,
        email: 'reader@example.com',
        role: Roles.BUYER,
      });
      expect(jwtService.signAsync).toHaveBeenCalledTimes(1);
    });

    it('rejects a SUSPENDED user with ACCOUNT_NOT_ACTIVE rather than EMAIL_NOT_VERIFIED', async () => {
      usersService.findByEmail.mockResolvedValue(verifiedUser({ status: UserStatus.SUSPENDED }));

      await expect(service.authenticate({ email: 'reader@example.com', password: PASSWORD })).rejects.toMatchObject({
        response: { code: AuthErrorCode.ACCOUNT_NOT_ACTIVE },
      });
    });

    it('rejects a soft-deleted user', async () => {
      usersService.findByEmail.mockResolvedValue(verifiedUser({ isDeleted: true }));

      await expect(service.authenticate({ email: 'reader@example.com', password: PASSWORD })).rejects.toMatchObject({
        response: { code: AuthErrorCode.ACCOUNT_NOT_ACTIVE },
      });
    });

    it('lets the admin/CRM path opt out of the gate explicitly', async () => {
      usersService.findByEmail.mockResolvedValue(unverifiedUser({ role: Roles.ADMIN }));

      const result = await service.authenticate(
        { email: 'reader@example.com', password: PASSWORD },
        { allowUnverifiedEmail: true },
      );

      expect(result.accessToken).toBe(ACCESS_TOKEN);
    });
  });

  describe('authenticate — credential errors', () => {
    it('returns 401 INVALID_CREDENTIALS for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const promise = service.authenticate({ email: 'nobody@example.com', password: PASSWORD });

      await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(promise).rejects.toMatchObject({ response: { code: AuthErrorCode.INVALID_CREDENTIALS } });
    });

    it('returns the SAME response for a wrong password as for an unknown email (no user enumeration)', async () => {
      usersService.findByEmail.mockResolvedValue(verifiedUser());
      hashingProvider.comparePassword.mockResolvedValue(false);

      const wrongPassword = await service
        .authenticate({ email: 'reader@example.com', password: 'Wrong-Password-1!' })
        .then(() => null)
        .catch((e: HttpException) => e);

      usersService.findByEmail.mockResolvedValue(null);
      const unknownEmail = await service
        .authenticate({ email: 'nobody@example.com', password: PASSWORD })
        .then(() => null)
        .catch((e: HttpException) => e);

      expect(wrongPassword).toBeInstanceOf(HttpException);
      expect(unknownEmail).toBeInstanceOf(HttpException);

      expect(wrongPassword!.getStatus()).toBe(unknownEmail!.getStatus());
      expect(wrongPassword!.getResponse()).toEqual(unknownEmail!.getResponse());
    });

    it('does not disclose verification status to someone with the wrong password', async () => {
      usersService.findByEmail.mockResolvedValue(unverifiedUser());
      hashingProvider.comparePassword.mockResolvedValue(false);

      await expect(
        service.authenticate({ email: 'reader@example.com', password: 'Wrong-Password-1!' }),
      ).rejects.toMatchObject({ response: { code: AuthErrorCode.INVALID_CREDENTIALS } });
    });

    it('returns PASSWORD_NOT_SET when the account has no password hash', async () => {
      usersService.findByEmail.mockResolvedValue(verifiedUser({ passwordHash: null }));

      const promise = service.authenticate({ email: 'reader@example.com', password: PASSWORD });

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({ response: { code: AuthErrorCode.PASSWORD_NOT_SET } });
    });
  });

  describe('verifyRegistration', () => {
    it('activates the account and issues a token once the OTP checks out', async () => {
      const pending = unverifiedUser();
      usersService.findByEmail.mockResolvedValue(pending);
      otpService.verifyOtp.mockResolvedValue(true);
      usersService.activateUser.mockResolvedValue(verifiedUser());

      const result = await service.verifyRegistration({ email: 'reader@example.com', otp: '123456' });

      expect(usersService.activateUser).toHaveBeenCalledWith(11);
      expect(result.accessToken).toBe(ACCESS_TOKEN);
    });

    it('issues no token when the OTP is wrong', async () => {
      usersService.findByEmail.mockResolvedValue(unverifiedUser());
      otpService.verifyOtp.mockResolvedValue(false);

      await expect(service.verifyRegistration({ email: 'reader@example.com', otp: '000000' })).rejects.toMatchObject({
        response: { code: AuthErrorCode.INVALID_OTP },
      });
      expect(usersService.activateUser).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('passwordless login paths', () => {
    it('refuses to send a login OTP to an unverified account', async () => {
      usersService.findByEmail.mockResolvedValue(unverifiedUser());

      await expect(service.requestLoginOtp('reader@example.com')).rejects.toMatchObject({
        response: { code: AuthErrorCode.EMAIL_NOT_VERIFIED },
      });
      expect(otpService.generateAndSaveOtp).not.toHaveBeenCalled();
    });

    it('sends a login OTP for a verified account', async () => {
      usersService.findByEmail.mockResolvedValue(verifiedUser());
      otpService.generateAndSaveOtp.mockResolvedValue('654321');

      const result = await service.requestLoginOtp('reader@example.com');

      expect(result.email).toBe('reader@example.com');
      expect(rmqClient.emit).toHaveBeenCalledWith(
        'email_verification.requested',
        expect.objectContaining({ email: 'reader@example.com', otp: '654321' }),
      );
    });

    it('verifyLoginOtp will not mint a token for an unverified account', async () => {
      otpService.verifyOtp.mockResolvedValue(true);
      usersService.findByEmail.mockResolvedValue(unverifiedUser());

      await expect(service.verifyLoginOtp('reader@example.com', '654321')).rejects.toMatchObject({
        response: { code: AuthErrorCode.EMAIL_NOT_VERIFIED },
      });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('creates a PENDING user and publishes the OTP email event', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      hashingProvider.hashPassword.mockResolvedValue('hashed-password');
      usersService.create.mockResolvedValue(verifiedUser({ id: 42, status: UserStatus.PENDING }));
      otpService.generateAndSaveOtp.mockResolvedValue('112233');

      const result = await service.register(registerPayload());

      expect(result.userId).toBe(42);
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Reader', middleName: 'Of', lastName: 'Books', role: Roles.BUYER }),
      );
      expect(rmqClient.emit).toHaveBeenCalledWith(
        'email_verification.requested',
        expect.objectContaining({ userId: 42, otp: '112233' }),
      );
    });

    it('still completes registration — and logs — when the broker publish fails', async () => {
      // Regression guard: emit() used to be left unsubscribed, so broker failures vanished
      // without a trace and nobody could tell why the OTP email never arrived.
      const loggerError = jest
        .spyOn(Reflect.get(service, 'logger') as Logger, 'error')
        .mockImplementation(() => undefined);
      usersService.findByEmail.mockResolvedValue(null);
      hashingProvider.hashPassword.mockResolvedValue('hashed-password');
      usersService.create.mockResolvedValue(verifiedUser({ id: 43, status: UserStatus.PENDING }));
      otpService.generateAndSaveOtp.mockResolvedValue('112233');
      rmqClient.emit.mockReturnValue(throwError(() => new Error('broker unreachable')));

      const result = await service.register(registerPayload());

      expect(result.userId).toBe(43);
      expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('Failed to publish'));
    });
  });
});
