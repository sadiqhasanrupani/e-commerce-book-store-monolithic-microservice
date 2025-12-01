import { Module } from '@nestjs/common';
import { BrowseController } from './browse.controller';
import { BrowseService } from './providers/browse.service';
import { AgeGroupsModule } from '../age-groups/age-groups.module';
import { CategoriesModule } from '../categories/categories.module';

import { TypeOrmModule } from '@nestjs/typeorm';
import { BrowseFormat } from '@app/contract/browse/entities/browse-format.entity';
import { BrowseCollection } from '@app/contract/browse/entities/browse-collection.entity';
import { BrowseAdminController } from './browse-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BrowseFormat, BrowseCollection]),
    AgeGroupsModule,
    CategoriesModule,
  ],
  controllers: [BrowseController, BrowseAdminController],
  providers: [BrowseService],
})
export class BrowseModule { }
