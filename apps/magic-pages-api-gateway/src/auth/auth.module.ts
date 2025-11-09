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

@Module({
  imports: [forwardRef(() => UsersModule), GlobalConfigModule],
  controllers: [AuthController],
  providers: [
    AuthService,
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
  exports: [AuthService, HashingProvider],
})
export class AuthModule { } // eslint-disable-line
