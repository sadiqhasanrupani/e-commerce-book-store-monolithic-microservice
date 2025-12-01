import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Book } from '@app/contract/books/entities/book.entity';
import { AgeGroup } from '@app/contract/age-groups/entities/age-group.entity';
import { BookAgeGroupsAdminController } from './book-age-groups-admin.controller';
import { BookAgeGroupsService } from './providers/book-age-groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([Book, AgeGroup])],
  controllers: [BookAgeGroupsAdminController],
  providers: [BookAgeGroupsService],
})
export class BookAgeGroupsModule { }
