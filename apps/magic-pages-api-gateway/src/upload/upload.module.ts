import { Module } from '@nestjs/common';
import { UploadService } from './providers/upload.service';
import { UploadToStorageProvider } from './providers/upload-to-storage.provider';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Upload } from '@app/contract/uploads/entities/upload.entity';
import { UploadController } from './upload.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Upload])],
  controllers: [UploadController],
  providers: [UploadService, UploadToStorageProvider],
  // `UploadToStorageProvider` is exported so the books module (and anything
  // else that needs raw object-storage access) can call it in-process. It used
  // to be reached over TCP via the `storage` microservice, which has been
  // folded into this module.
  exports: [UploadService, UploadToStorageProvider, TypeOrmModule],
})
export class UploadModule { }
