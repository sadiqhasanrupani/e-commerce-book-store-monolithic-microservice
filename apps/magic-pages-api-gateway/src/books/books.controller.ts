import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFiles,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import { BooksService } from './providers/books.service';

import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiHeaders, ApiOperation } from '@nestjs/swagger';

import { FilesValidationPipe } from '@app/contract/pipes/file-validation.pipe';

@Controller('books')
export class BooksController {
  constructor(
    /**
     * Injecting Book Service
     * */
    private readonly booksService: BooksService,
  ) { } //eslint-disable-line

  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'bookCover', maxCount: 1 },
      { name: 'snapshots', maxCount: 5 },
      { name: 'file', maxCount: 1 },
    ]),
  )
  @ApiHeaders([
    {
      name: 'Content-Type',
      description: 'multipart/form-data',
    },
  ])
  @ApiOperation({ summary: 'Book Creation' })
  @Post()
  create(
    @Body() createBookDto: CreateBookDto,
    @UploadedFiles(
      new FilesValidationPipe({
        images: ['image/gif', 'image/jpeg', 'image/png'],
        file: [
          'application/pdf',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
      }),
    )
    files?: {
      bookCover: Express.Multer.File;
      snapshots?: Express.Multer.File[];
      file?: Express.Multer.File;
    },
  ) {
    try {
      return this.booksService.create({
        files,
        createBookDto,
      });
    } catch (error: unknown) {
      let message = 'something went wrong in book service';

      if (error instanceof Error) {
        message = error.message;
      }

      throw new HttpException({ message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  findAll() {
    return this.booksService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.booksService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateBookDto: UpdateBookDto) {
    return this.booksService.update(+id, updateBookDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.booksService.remove(+id);
  }
}
