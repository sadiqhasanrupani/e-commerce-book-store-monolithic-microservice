import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// modules
import { UsersModule } from '../users/users.module';
import { GlobalConfigModule } from '@app/global-config';

// controllers
import { AuthController } from './auth.controller';

// providers
import { AuthService } from './providers/auth.service';
import { HashingProvider } from './providers/hashing.provider';
import { BcryptProvider } from './providers/bcrypt.provider';
import { Argon2Provider } from './providers/argon2.provider';
import { MailService } from './providers/mail.service';
import { OtpService } from './providers/otp.service';
// import { GoogleAuthenticationService } from './providers/google-authentication.service';
import { EmailConsumer } from './consumers/email.consumer';
import { RmqModule } from '@rmq/rmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailVerification } from '@app/contract/auth/entities/email-verification.entity';
import { User } from '@app/contract/users/entities/user.entity';
import { UserContextService } from './providers/user-context.service';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    GlobalConfigModule,
    RmqModule.registerAsync(),
    TypeOrmModule.forFeature([EmailVerification, User]),
  ],
  controllers: [AuthController, EmailConsumer],
  providers: [
    AuthService,
    MailService,
    OtpService,
    OtpService,
    UserContextService,
    // GoogleAuthenticationService,
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
export class AuthModule { } // eslint-disable-line
