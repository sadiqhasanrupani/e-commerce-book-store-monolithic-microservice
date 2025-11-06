import { TypeOrmModule } from '@nestjs/typeorm';

import { Module } from '@nestjs/common';
import typeOrmOptions from '../configs/typeorm.config';

@Module({
  imports: [TypeOrmModule.forRootAsync(typeOrmOptions)],
  exports: [TypeOrmModule],
})
export class DatabaseModule { } //eslint-disable-line
