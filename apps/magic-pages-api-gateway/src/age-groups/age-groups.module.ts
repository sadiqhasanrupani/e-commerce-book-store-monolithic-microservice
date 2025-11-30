import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgeGroup } from '@app/contract/age-groups/entities/age-group.entity';
import { AgeGroupsController } from './age-groups.controller';
import { AgeGroupsService } from './providers/age-groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([AgeGroup])],
  controllers: [AgeGroupsController],
  providers: [AgeGroupsService],
  exports: [AgeGroupsService],
})
export class AgeGroupsModule { }
