import { Module } from '@nestjs/common';

/**
 * Main module for the Magic Pages API Gateway application.
 * It imports and integrates various feature modules and global configurations.
 */
import { GlobalConfigModule } from '@app/global-config';
import { DatabaseModule } from '@app/database';

/**
 * Feature modules
 */
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { BooksModule } from './books/books.module';
import { UploadModule } from './upload/upload.module';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticationGuard } from './auth/guards/authenticate/authenticate.guard';
import { AccessTokenGuard } from './auth/guards/access-token/access-token.guard';
import { AuthorizationGuard } from './auth/guards/authorization/authorization.guard';
import { RoleBaseAccessTokenGuard } from './auth/guards/role-base-access-token/role-base-access-token.guard';

@Module({
  imports: [
    /**
     * Global configuration and database connection
     */
    GlobalConfigModule,
    DatabaseModule,
    /**
     * Feature modules
     */
    UsersModule,
    AuthModule,
    BooksModule,
    UploadModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthenticationGuard,
    },
    AccessTokenGuard,
    {
      provide: APP_GUARD,
      useClass: AuthorizationGuard,
    },
    RoleBaseAccessTokenGuard,
  ],
})
export class MagicPagesApiGatewayModule { } // eslint-disable-line
