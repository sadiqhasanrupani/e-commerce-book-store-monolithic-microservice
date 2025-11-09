import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';

import databaseConfig from '../configs/database.config';
import minioConfig from '../configs/minio.config';
import hashConfig from '../configs/hash.config';
import jwtConfig from '@app/contract/auth/configs/jwt.config';

import environmentSchema from '../schemas/environment.schema';

const NODE_ENV = process.env.NODE_ENV || 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: NODE_ENV ? `.env.${NODE_ENV}` : '.env',
      load: [databaseConfig, minioConfig, jwtConfig, hashConfig],
      validationSchema: environmentSchema,
    }),
    ConfigModule.forFeature(jwtConfig),
    JwtModule.registerAsync(jwtConfig.asProvider()),
  ],
  exports: [JwtModule, ConfigModule],
})
export class GlobalConfigModule { } // eslint-disable-line
