import { Module } from '@nestjs/common';
import { LocationController } from './location.controller';
import { LocationService } from './providers/location.service';

@Module({
  controllers: [LocationController],
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule { }
