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


@Module({
  imports: [
    /**
     * Global configuration and database connection
     */
    GlobalConfigModule, DatabaseModule,
    /**
     * Feature modules
     */
    UsersModule, AuthModule,
  ],
})
export class MagicPagesApiGatewayModule { }
