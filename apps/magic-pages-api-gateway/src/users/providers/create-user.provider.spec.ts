/**
 * @fileoverview Unit tests for CreateUserProvider
 * @description
 * This spec file verifies the behavior of CreateUserProvider, including:
 *  - successful user creation flow
 *  - email duplication handling
 *  - database transaction failure
 *  - Google OAuth user creation (without password)
 *
 * Each test mocks dependent services such as TypeORM Repository, DataSource transaction,
 * EventEmitter2, and AuditService to ensure isolated behavior verification.
 */

import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CreateUserProvider } from './create-user.provider';
import { User } from '@app/contract/users/entities/user.entity';
import { CreateUserDto } from '@app/contract/users/dtos/create-user.dto';

/**
 * Type-safe mock for DataSource with transaction method
 */
interface MockDataSource {
  transaction: jest.Mock<Promise<unknown>, [fn: (manager: any) => Promise<unknown>]>;
}

/**
 * Type-safe mock for AuditService
 */
interface MockAuditService {
  logAction: jest.Mock<Promise<void>, [Record<string, unknown>]>;
}

/**
 * Type-safe mock for EventEmitter2
 */
interface MockEventEmitter {
  emit: jest.Mock<void, [string, Record<string, unknown>]>;
}

describe('CreateUserProvider', () => {
  let provider: CreateUserProvider;
  let userRepo: jest.Mocked<Repository<User>>;
  let mockDataSource: MockDataSource;
  let mockAuditService: MockAuditService;
  let mockEventEmitter: MockEventEmitter;

  /**
   * Setup mocks and NestJS testing module before each test
   */
  beforeEach(async () => {
    // Strongly-typed repository mock
    const repositoryMock: Partial<jest.Mocked<Repository<User>>> = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    userRepo = repositoryMock as jest.Mocked<Repository<User>>;

    // Mock DataSource with a transactional executor
    mockDataSource = {
      transaction: jest.fn(async (fn) =>
        fn({
          save: userRepo.save, // eslint-disable-line
        }),
      ),
    };

    // Mock AuditService and EventEmitter2
    mockAuditService = {
      logAction: jest.fn<Promise<void>, [Record<string, unknown>]>(),
    };
    mockAuditService.logAction.mockResolvedValue(undefined);
    mockEventEmitter = { emit: jest.fn() }; // eslint-disable-line

    // Initialize testing module
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateUserProvider,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: 'AUDIT_SERVICE', useValue: mockAuditService },
        { provide: EventEmitter2, useValue: mockEventEmitter as unknown as EventEmitter2 }, // eslint-disable-line
      ],
    }).compile();

    provider = module.get<CreateUserProvider>(CreateUserProvider);
  });

  /**
   * Reset all mocks after each test to avoid test contamination
   */
  afterEach(() => jest.clearAllMocks());

  /**
   * ✅ Test: Successful user creation flow
   */
  it('should create a user successfully', async () => {
    const dto: CreateUserDto = {
      email: 'test@example.com',
      password: 'securepass',
      role: 'buyer',
    };

    userRepo.findOne.mockResolvedValue(null);
    userRepo.create.mockReturnValue({
      email: dto.email,
      passwordHash: 'hashedpass',
      role: dto.role,
    } as User);
    userRepo.save.mockResolvedValue({
      userId: 1,
      email: dto.email,
      role: dto.role,
      isDeleted: false,
    } as User);

    const result = await provider.createUser(dto);

    expect(userRepo.findOne).toHaveBeenCalledWith({ // eslint-disable-line
      where: { email: 'test@example.com', isDeleted: false },
    });
    expect(mockAuditService.logAction).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('user.created', expect.objectContaining({ email: dto.email }));
    expect(result.email).toBe(dto.email);
    expect(result.role).toBe('buyer');
  });

  /**
   * Test: Duplicate email should trigger ConflictException
   */
  it('should throw ConflictException if email already exists', async () => {
    const existingUser = { userId: 1, email: 'existing@example.com' } as User;
    userRepo.findOne.mockResolvedValue(existingUser);

    await expect(
      provider.createUser({
        email: 'existing@example.com',
        password: 'testpass',
      } as CreateUserDto),
    ).rejects.toThrow(ConflictException);

    expect(userRepo.findOne).toHaveBeenCalledTimes(1); //eslint-disable-line
  });

  /**
   * Test: Simulate database transaction failure
   */
  it('should throw InternalServerErrorException on DB failure', async () => {
    const dto: CreateUserDto = {
      email: 'fail@example.com',
      password: 'securepass',
    };

    userRepo.findOne.mockResolvedValue(null);
    userRepo.create.mockReturnValue({
      email: dto.email,
      passwordHash: 'hash',
    } as User);
    mockDataSource.transaction.mockRejectedValueOnce(new Error('DB error'));

    await expect(provider.createUser(dto)).rejects.toThrow(InternalServerErrorException);

    expect(mockAuditService.logAction).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  /**
   * Test: Google OAuth user creation (no password hashing)
   */
  it('should handle Google user creation without password', async () => {
    const dto: CreateUserDto = {
      email: 'google@example.com',
      googleId: 'google123',
    };

    userRepo.findOne.mockResolvedValue(null);
    userRepo.create.mockReturnValue({
      email: dto.email,
      googleId: dto.googleId,
      role: 'buyer',
    } as User);
    userRepo.save.mockResolvedValue({
      userId: 2,
      email: dto.email,
      googleId: dto.googleId,
      role: 'buyer',
    } as User);

    const result = await provider.createUser(dto);

    expect(result.googleId).toBe('google123');
    expect(mockAuditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: 'users',
        action: 'CREATE',
      }),
    );
  });
});
