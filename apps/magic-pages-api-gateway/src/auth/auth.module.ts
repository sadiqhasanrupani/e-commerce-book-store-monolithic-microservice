import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// modules
import { UsersModule } from '../users/users.module';
import { GlobalConfigModule } from '@app/global-config';

// controllers
import { AuthController } from './auth.controller';
import { AuthAdminController } from './auth-admin.controller';

// providers
import { AuthService } from './providers/auth.service';
import { HashingProvider } from './providers/hashing.provider';
import { BcryptProvider } from './providers/bcrypt.provider';
import { Argon2Provider } from './providers/argon2.provider';
import { MailModule } from '../mail/mail.module';
import { OtpService } from './providers/otp.service';
import { EmailConsumer } from '../mail/consumers/email.consumer';
import { RmqModule } from '@rmq/rmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailVerification } from '@app/contract/auth/entities/email-verification.entity';
import { UserContextService } from './providers/user-context.service';

import { User } from '@app/contract/users/entities/user.entity';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    GlobalConfigModule,
    RmqModule.registerAsync(),
    TypeOrmModule.forFeature([EmailVerification, User]),
    // `MailService` lives in its own module so digital delivery can send mail
    // without importing the whole auth graph. Auth's own consumers (AuthService,
    // EmailConsumer) resolve it through this import exactly as before.
    MailModule,
  ],
  // `EmailConsumer`'s source now lives under `src/mail/consumers/` with the rest
  // of the mail layer, but it stays REGISTERED here rather than in `MailModule`.
  // It needs `RmqService`, and `AuthModule` already imports `RmqModule`; moving
  // the registration would force `MailModule` to import RabbitMQ too, which
  // would drag an RMQ dependency into every module that only wants to send an
  // e-mail (digital delivery, orders) — the exact coupling `MailModule` exists
  // to avoid. It also consumes an auth-domain event, `email_verification.requested`.
  controllers: [AuthController, AuthAdminController, EmailConsumer],
  providers: [
    AuthService,
    OtpService,
    OtpService,
    UserContextService,
    {
      provide: HashingProvider,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const algorithm = configService.get<string>('hash.algorithm', 'hash.bcrypt');

        if (algorithm === 'argon2') {
          return new Argon2Provider(configService);
        }

        return new BcryptProvider();
      },
    },
  ],
  exports: [AuthService, HashingProvider, UserContextService],
})
export class AuthModule { }
