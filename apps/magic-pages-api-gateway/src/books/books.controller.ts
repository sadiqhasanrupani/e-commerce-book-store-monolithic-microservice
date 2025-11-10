import {
  Controller,
  Post,
  Body,
  Param,
  Delete,
  UseInterceptors,
  UploadedFiles,
  HttpException,
  HttpStatus,
  Query,
  Put,
  HttpCode,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';

import { BooksService } from './providers/books.service';

import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeaders, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

import { FilesValidationPipe } from '@app/contract/pipes/file-validation.pipe';

import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { ParseEntityIdPipe } from '@app/contract/pipes/parse-entity-id.pipe';
import { DeleteOption } from '@app/contract/books/types/delete-book.type';
import { Book } from '@app/contract/books/entities/book.entity';

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
  @Role(RoleTypes.ADMIN)
  @Post()
  create(
    @Body() createBookDto: CreateBookDto,
    @UploadedFiles(
      new FilesValidationPipe({
        allowedMimes: {
          bookCover: ['image/jpeg', 'image/png'],
          snapshots: ['image/jpeg', 'image/png', 'image/gif'],
          file: [
            'application/pdf',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ],
        },
        requiredFields: ['bookCover', 'file']
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

  // @Get()
  // findAll() {
  //   return this.booksService.findAll();
  // }
  //
  // @Get(':id')
  // findOne(@Param('id', ParseIntPipe) id: number) {
  //   return this.booksService.findOne(id);
  // }

  /**
    * Updates an existing book by its unique identifier.
    *
    * ### Features:
    * - Allows partial updates (title, author, description, etc.)
    * - Supports file uploads (book cover, snapshots, and content files)
    * - Replaces existing files if new ones are provided
    * - Maintains existing URLs if no new files are uploaded
    *
    * ### Content-Type:
    * `multipart/form-data`
    *
    * ### Example Request:
    * ```bash
    * PUT /books/12
    * Content-Type: multipart/form-data
    *
    * Form Data:
    * title=Updated Book Title
    * price=249.99
    * bookCover=<file>
    * file=<file.pdf>
    * snapshots=<file1.png>, <file2.png>
    * ```
    */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'bookCover', maxCount: 1 },
      { name: 'snapshots', maxCount: 5 },
      { name: 'file', maxCount: 2 },
    ]),
  )
  @ApiOperation({
    summary: 'Update an existing book record',
    description:
      'Updates the details of a specific book, allowing metadata and uploaded files to be replaced.',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
    description: 'The unique identifier of the book to update.',
    example: 12,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Book update payload (metadata + files)',
    type: UpdateBookDto,
  })
  @ApiResponse({
    status: 200,
    description: 'The updated book entity is returned.',
    type: Book,
  })
  @ApiResponse({
    status: 404,
    description: 'Book not found for the given ID.',
  })
  async updateBook(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBookDto: UpdateBookDto,
    @UploadedFiles()
    files?: {
      bookCover?: Express.Multer.File[];
      snapshots?: Express.Multer.File[];
      file?: Express.Multer.File[];
    },
  ) {
    const updated = await this.booksService.updateBook(id, updateBookDto, files);
    if (!updated) throw new NotFoundException(`Book with ID ${id} not found`);
    return {
      message: "Book updated successfully",
      updatedBook: updated
    };
  }

  @Delete(':id')
  async deleteBook(
    @Param('id', ParseEntityIdPipe) id: number,
    @Query('force') force?: string,
    @Query('archivePrefix') archivePrefix?: string,
  ) {
    const options: DeleteOption = {
      force: force === 'true',
      archivePrefix: archivePrefix ?? 'archive/',
    };

    const result = await this.booksService.deleteBook(id, options);
    return result;
  }
}
