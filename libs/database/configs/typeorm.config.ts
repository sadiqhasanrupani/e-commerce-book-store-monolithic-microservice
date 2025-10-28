import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';

const typeOrmOptions: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const databaseUrl = configService.get<string>('database.databaseUrl');
    const databaseName = configService.get<string>('database.databaseName');
    const username = configService.get<string>('database.databaseUsername');
    const password = configService.get<string>('database.databasePassword');
    const port = Number(configService.get<string>('database.databasePort'));
    const host = configService.get<string>('database.databaseHost');
    const synchronize = configService.get<boolean>('database.synchronize');
    const autoLoadEntities = configService.get<boolean>('database.autoLoadEntities');

    // If password is empty and we have a DATABASE_URL, use it directly
    if ((!password || password === '') && databaseUrl) {
      return {
        type: 'postgres',
        url: databaseUrl,
        autoLoadEntities,
        synchronize,
        ssl: false
      };
    }

    // Use individual connection parameters
    return {
      type: 'postgres',
      database: databaseName,
      host,
      port,
      username,
      password: password || '',
      autoLoadEntities,
      synchronize,
      ssl: false
    };
  },
};

export default typeOrmOptions;
