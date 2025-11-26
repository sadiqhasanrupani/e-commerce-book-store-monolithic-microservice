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
  Get,
} from '@nestjs/common';

import { BooksService } from './providers/books.service';

import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';

import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { FilesValidationPipe } from '@app/contract/pipes/file-validation.pipe';

import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { DeleteOption } from '@app/contract/books/types/delete-book.type';
import { Book } from '@app/contract/books/entities/book.entity';
import {
  FindAllBookQueryParam,
  FindAllBookResponse,
} from '@app/contract/books/types/find-book.type';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';

@ApiTags('Books')
@Controller('books')
export class BooksController {
  constructor(private readonly booksService: BooksService) { }

  // ---------------------------------------------------------------------
  // 📌 CREATE BOOK
  // ---------------------------------------------------------------------
  @Post()
  @ApiOperation({
    summary: 'Create a new book with variants & files',
    description:
      'Creates a book along with its format variants inside a single transaction.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Create book payload including variants and file uploads',
    schema: {
      type: 'object',
      properties: {
        // ---------- Book metadata ----------
        title: { type: 'string', example: 'The Magic Pages' },
        subtitle: { type: 'string', example: 'A Journey Begins', nullable: true },
        description: { type: 'string', example: 'A magical book for kids.' },
        authorId: { type: 'string', format: 'uuid', nullable: true },
        authorName: { type: 'string', example: 'John Doe', nullable: true },
        genre: { type: 'string', example: 'fantasy' },

        // ---------- Variants ----------
        variants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              format: { type: 'string', example: 'PDF' },
              priceCents: { type: 'number', example: 199 },
              stockQuantity: { type: 'number', example: 0 },
              isbn: { type: 'string', example: '978-3-16-148410-0' },
            },
          },
        },

        // ---------- Files ----------
        bookCover: { type: 'string', format: 'binary' },
        snapshots: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        variantFiles: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Book created successfully.' })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'bookCover', maxCount: 1 },
      { name: 'snapshots', maxCount: 10 },
      { name: 'variantFiles', maxCount: 10 },
    ]),
  )
  async create(
    @Body() createBookDto: CreateBookDto,
    @UploadedFiles(
      new FilesValidationPipe({
        allowedMimes: {
          bookCover: ['image/jpeg', 'image/png'],
          snapshots: ['image/jpeg', 'image/png'],
          variantFiles: ['application/pdf'],
        },
      }),
    )
    files?: {
      bookCover?: Express.Multer.File[];
      snapshots?: Express.Multer.File[];
      variantFiles?: Express.Multer.File[];
    },
  ) {
    try {
      const normalizedFiles = {
        bookCover: files?.bookCover?.[0],
        snapshots: files?.snapshots || [],
        variantFiles: files?.variantFiles || [],
      };

      const created = await this.booksService.create({
        createBookDto,
        files: normalizedFiles,
      });

      return { message: 'Book created successfully', data: created };
    } catch (err: any) {
      throw new HttpException(
        { message: err?.message || 'Failed to create book' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ---------------------------------------------------------------------
  // 📌 UPDATE BOOK
  // ---------------------------------------------------------------------
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update an existing book',
    description:
      'Updates book metadata, variants, and replaces uploaded assets inside a transaction.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    example: '5ec98e94-3b84-4b70-8727-bff123c1ea92',
  })
  @ApiBody({
    description: 'Update book metadata and uploaded files',
    type: UpdateBookDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Book updated successfully',
    type: Book,
  })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'bookCover', maxCount: 1 },
      { name: 'snapshots', maxCount: 10 },
      { name: 'variantFiles', maxCount: 10 },
    ]),
  )
  async updateBook(
    @Param('id') id: string,
    @Body() dto: UpdateBookDto,
    @UploadedFiles()
    files?: {
      bookCover?: Express.Multer.File;
      snapshots?: Express.Multer.File[];
      variantFiles?: Express.Multer.File[];
    },
  ) {
    const updated = await this.booksService.updateBook(id, dto, files);

    return {
      message: 'Book updated successfully',
      updatedBook: updated,
    };
  }

  // ---------------------------------------------------------------------
  // 📌 FIND ALL BOOKS
  // ---------------------------------------------------------------------
  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Get()
  @ApiOperation({
    summary: 'List books with pagination, filtering, sorting',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated book list',
  })
  async findAll(
    @Query() query: FindAllBookQueryParam,
  ): Promise<FindAllBookResponse> {
    return this.booksService.findAll(query);
  }

  // ---------------------------------------------------------------------
  // 📌 FIND ONE (PUBLIC)
  // ---------------------------------------------------------------------
  @Get(':id')
  @ApiOperation({
    summary: 'Get a book by ID (public)',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    example: '5ec98e94-3b84-4b70-8727-bff123c1ea92',
  })
  async findOne(@Param('id') id: string) {
    return this.booksService.findOne(id as any, {});
  }

  // ---------------------------------------------------------------------
  // 📌 DELETE BOOK
  // ---------------------------------------------------------------------
  @Delete(':id')
  @ApiOperation({ summary: 'Delete or archive a book' })
  @ApiParam({
    name: 'id',
    type: 'string',
    example: '5ec98e94-3b84-4b70-8727-bff123c1ea92',
  })
  async deleteBook(
    @Param('id') id: string,
    @Query('force') force?: string,
    @Query('archivePrefix') archivePrefix?: string,
  ) {
    const opts: DeleteOption = {
      force: force === 'true',
      archivePrefix: archivePrefix ?? 'archive/',
    };
    return this.booksService.deleteBook(id, opts);
  }
}
