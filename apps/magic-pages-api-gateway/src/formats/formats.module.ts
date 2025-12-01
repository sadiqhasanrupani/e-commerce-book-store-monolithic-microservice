import { Module } from '@nestjs/common';
import { FormatsController } from './formats.controller';
import { FormatsService } from './providers/formats.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrowseFormat } from '@app/contract/browse/entities/browse-format.entity';
import { BooksModule } from '../books/books.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BrowseFormat]),
    BooksModule,
  ],
  controllers: [FormatsController],
  providers: [FormatsService],
})
export class FormatsModule { }
