import { Module } from '@nestjs/common';
import { BrowseController } from './browse.controller';
import { BrowseService } from './providers/browse.service';
import { AgeGroupsModule } from '../age-groups/age-groups.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    AgeGroupsModule,
    CategoriesModule,
  ],
  controllers: [BrowseController],
  providers: [BrowseService],
})
export class BrowseModule { }
