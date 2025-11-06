import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';

const typeOrmOptions: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const databaseUrl = configService.get<string>('database.databaseUrl');
    const synchronize = configService.get<boolean>('database.synchronize');
    const autoLoadEntities = configService.get<boolean>('database.autoLoadEntities');

    return {
      type: 'postgres',
      url: databaseUrl,
      autoLoadEntities,
      synchronize,
    };
  },
};

export default typeOrmOptions;
