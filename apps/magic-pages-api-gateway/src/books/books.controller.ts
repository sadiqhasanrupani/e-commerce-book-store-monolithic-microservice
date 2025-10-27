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
import { BooksService } from './books.service';

import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiHeaders, ApiOperation } from '@nestjs/swagger';

import { UploadService } from '../upload/providers/upload.service';

import { FilesValidationPipe } from '@app/contract/pipes/file-validation.pipe';
import { CreateBookData } from '@app/contract/books/types/books.type';

@Controller('books')
export class BooksController {
  constructor(
    /**
     * Injecting Book Service
     * */
    private readonly booksService: BooksService,
  ) { }

  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 10 },
        { name: 'file', maxCount: 1 }
      ]
    )
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
    @UploadedFiles(new FilesValidationPipe({
      images: [
        'image/gif',
        'image/jpeg',
        'image/png',
      ],
      file: [
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
    }))
    files?: {
      images?: Express.Multer.File[],
      files?: Express.Multer.File[]
    },
  ) {

    try {
      return this.booksService.create({
        files,
        createBookDto
      });

    } catch (error) {
      throw new HttpException(
        { message: "something went wrong in book service" },
        HttpStatus.INTERNAL_SERVER_ERROR
      )
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
