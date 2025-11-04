import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import databaseConfig from '../configs/database.config';
import minioConfig from '../configs/minio.config';

import environmentSchema from '../schemas/environment.schema';

const NODE_ENV = process.env.NODE_ENV || 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: NODE_ENV ? `.env.${NODE_ENV}` : '.env',
      load: [databaseConfig, minioConfig],
      validationSchema: environmentSchema,
    }),
  ],
})
export class GlobalConfigModule {}
