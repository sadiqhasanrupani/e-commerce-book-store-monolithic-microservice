import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgeGroup } from '@app/contract/age-groups/entities/age-group.entity';
import { AgeGroupsController } from './age-groups.controller';
import { AgeGroupsService } from './providers/age-groups.service';

import { BooksModule } from '../books/books.module';
import { AgesController } from './ages.controller';
import { AuthModule } from '../auth/auth.module';

import { AgeGroupsAdminController } from './age-groups-admin.controller';

import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgeGroup]),
    BooksModule,
    AuthModule,
    UploadModule,
  ],
  controllers: [AgeGroupsController, AgesController, AgeGroupsAdminController],
  providers: [AgeGroupsService],
  exports: [AgeGroupsService],
})
export class AgeGroupsModule { }
