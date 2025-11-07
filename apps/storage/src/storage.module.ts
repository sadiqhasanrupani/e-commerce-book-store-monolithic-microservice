import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

import { GlobalConfigModule } from '@app/global-config';

import { UploadToStorageProvider } from './providers/upload-to-storage.provider';
// import { MinioService } from './providers/minio.service';

@Module({
  imports: [GlobalConfigModule],
  controllers: [StorageController],
  providers: [StorageService, UploadToStorageProvider],
})
