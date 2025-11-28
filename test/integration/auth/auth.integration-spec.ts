import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MagicPagesApiGatewayModule } from 'apps/magic-pages-api-gateway/src/magic-pages-api-gateway.module';
import { MailService } from 'apps/magic-pages-api-gateway/src/auth/providers/mail.service';
import { DataSource } from 'typeorm';
import { EmailVerification } from '@app/contract/auth/entities/email-verification.entity';
import { User } from '@app/contract/users/entities/user.entity';

describe('Auth Integration', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MagicPagesApiGatewayModule],
    })
      .overrideProvider(MailService)
      .useValue({
        sendVerificationEmail: jest.fn().mockResolvedValue(true),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean up DB
    await dataSource.query('TRUNCATE TABLE "email_verifications" CASCADE');
    await dataSource.query('TRUNCATE TABLE "users" CASCADE');
  });

  it('should register, verify, and login', async () => {
    const email = 'integration@example.com';
    const password = 'password123';

    // 1. Register
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password,
        fullName: 'Integration Test User',
      })
      .expect((res) => {
        if (res.status !== 201) {
          console.error('Registration failed:', res.body);
        }
      })
      .expect(201);

    // 2. Get OTP from DB
    const user = await dataSource.getRepository(User).findOneBy({ email });
    expect(user).toBeDefined();
    if (!user) throw new Error('User not found');
    const verification = await dataSource.getRepository(EmailVerification).findOne({
      where: { userId: user.id, purpose: 'REGISTRATION' },
      order: { createdAt: 'DESC' },
    });

    expect(verification).toBeDefined();

    // Manually update the verification record in DB with a known hash.
    const bcrypt = require('bcrypt');
    const knownOtp = '123456';
    const hash = await bcrypt.hash(knownOtp, 12);
    if (!verification) throw new Error('Verification not found');
    verification.tokenHash = hash;
    await dataSource.getRepository(EmailVerification).save(verification);

    // 3. Verify
    const verifyResponse = await request(app.getHttpServer())
      .post('/auth/register/verify')
      .send({
        email,
        otp: knownOtp,
      })
      .expect(200);

    expect(verifyResponse.body).toHaveProperty('message', 'Verification successful');
    // Check cookies
    const cookies = verifyResponse.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    expect(Array.isArray(cookies)).toBeTruthy();
    expect(cookies.some((c) => c.includes('mp_access_token'))).toBeTruthy();
    expect(cookies.some((c) => c.includes('mp_refresh_token'))).toBeTruthy();

    // 4. Login
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password,
        fullName: 'Integration Test User', // Extra field should be ignored
      })
      .expect(200);

    expect(loginResponse.body).toHaveProperty('message', 'Login successful');
  });
});
