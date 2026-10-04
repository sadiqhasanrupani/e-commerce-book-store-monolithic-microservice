import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MagicPagesApiGatewayModule } from 'apps/magic-pages-api-gateway/src/magic-pages-api-gateway.module';
import { MailService } from 'apps/magic-pages-api-gateway/src/mail/mail.service';
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
      // 201, not 200: `@Post('register/verify')` carries no `@HttpCode(200)`, so
      // Nest's default POST status applies. That is the behaviour live today and
      // the storefront is built against it, so the stale assertion is what gets
      // corrected here — NOT the controller.
      .expect(201);

    // KNOWN STALE — this suite is still red here, for a reason that predates the
    // mail-provider refactor and is unrelated to it.
    //
    // Until 2026-08-26 this whole file failed to COMPILE (it imported `MailService`
    // from the old `auth/providers/` path), so nothing below the import line had run
    // in a long time and this drift was invisible. Fixing the import made it visible.
    //
    // The drift: `AuthService.verifyRegistration` now ends in `return this.signIn(...)`,
    // so a successful verification auto-logs the user in and responds with
    // `{ accessToken, email, role, userId }`. There is no `message`, and — because the
    // controller does not take `@Res()` — no `set-cookie` header either, so the three
    // cookie assertions below are stale too.
    //
    // Deliberately NOT rewritten to match the implementation: doing that would
    // rubber-stamp the current behaviour rather than test it. Which side is stale is a
    // product question (does the storefront read a token body, or expect cookies?) and
    // this is a live client backend, so it needs Sadiq's call, not a guess from the
    // code. See internal-docs/eng-log/2026-08-26-mail-provider-strategy-pattern.code-review.md.
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
