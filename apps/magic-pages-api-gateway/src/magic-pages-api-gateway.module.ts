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
import { LocationModule } from './location/location.module';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticationGuard } from './auth/guards/authenticate/authenticate.guard';
import { AccessTokenGuard } from './auth/guards/access-token/access-token.guard';
import { AuthorizationGuard } from './auth/guards/authorization/authorization.guard';
import { RoleBaseAccessTokenGuard } from './auth/guards/role-base-access-token/role-base-access-token.guard';
import { PaginationModule } from './common/pagination/pagination.module';
import { CartModule } from './cart/cart.module';
import { AgeGroupsModule } from './age-groups/age-groups.module';
import { CategoriesModule } from './categories/categories.module';
import { BrowseModule } from './browse/browse.module';
import { BookAgeGroupsModule } from './book-age-groups/book-age-groups.module';
import { PrometheusModule } from '../../../libs/common/src/metrics';
import { LoggerModule, RequestIdMiddleware, LoggingInterceptor } from '../../../libs/common/src/logging';
import { MiddlewareConsumer, RequestMethod, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    /**
     * Global configuration and database connection
     */
    GlobalConfigModule,
    DatabaseModule,
    PrometheusModule,
    LoggerModule,
    /**
     * Feature modules
     */
    UsersModule,
    AuthModule,
    BooksModule,
    UploadModule,
    LocationModule,
    PaginationModule,
    CartModule,
    AgeGroupsModule,
    CategoriesModule,
    BrowseModule,
    BookAgeGroupsModule,
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
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class MagicPagesApiGatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
