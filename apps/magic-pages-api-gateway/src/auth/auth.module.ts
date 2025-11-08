import { forwardRef, Module } from '@nestjs/common';

// modules
import { UsersModule } from '../users/users.module';

// controlllers
import { AuthController } from './auth.controller';

// providers
import { AuthService } from './providers/auth.service';
import { HashingProvider } from './providers/hashing.provider';
import { BcryptProvider } from './providers/bcrypt.provider';

@Module({
  imports: [forwardRef(() => UsersModule)],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: HashingProvider,
      useClass: BcryptProvider,
    },
  ],
  exports: [AuthService, HashingProvider],
})
export class AuthModule { } // eslint-disable-line
