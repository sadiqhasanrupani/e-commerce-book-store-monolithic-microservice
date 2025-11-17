import { Module } from '@nestjs/common';
import { UploadService } from './providers/upload.service';
import { UploadToStorageProvider } from './providers/upload-to-storage.provider';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Upload } from '@app/contract/uploads/entities/upload.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Upload])],
  providers: [UploadService, UploadToStorageProvider],
  exports: [UploadService, TypeOrmModule],
})
export class UploadModule {}
