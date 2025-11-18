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
  Get,
} from '@nestjs/common';

import { BooksService } from './providers/books.service';

import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { FilesValidationPipe } from '@app/contract/pipes/file-validation.pipe';

import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { ParseEntityIdPipe } from '@app/contract/pipes/parse-entity-id.pipe';
import { DeleteOption } from '@app/contract/books/types/delete-book.type';
import { Book } from '@app/contract/books/entities/book.entity';
import { FindAllBookQueryParam, FindAllBookResponse } from '@app/contract/books/types/find-book.type';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';

@Controller('books')
export class BooksController {
  constructor(
    /**
     * Injecting Book Service
     * */
    private readonly booksService: BooksService,
  ) { } //eslint-disable-line

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload book metadata and files',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', example: 'The Magic of Pages' },
        description: { type: 'string', example: 'A magical story for kids' },
        genre: { type: 'string', example: 'fiction' },
        formats: { type: 'string', example: 'pdf' },
        price: { type: 'number', example: 99.99 },
        authorName: { type: 'string', example: 'John Doe' },
        bookCover: {
          type: 'string',
          format: 'binary',
        },
        snapshots: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Book created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file or missing fields' })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'bookCover', maxCount: 1 },
      { name: 'snapshots', maxCount: 5 },
      { name: 'file', maxCount: 1 },
    ]),
  )
  async create(
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
        requiredFields: ['bookCover', 'file'],
      }),
    )
    files?: {
      bookCover?: Express.Multer.File[];
      snapshots?: Express.Multer.File[];
      file?: Express.Multer.File[];
    },
  ) {
    try {
      // Normalize the files object to simpler single-file format
      const normalizedFiles = {
        bookCover: files?.bookCover?.[0],
        snapshots: files?.snapshots || [],
        file: files?.file?.[0],
      };

      const result = await this.booksService.create({
        createBookDto,
        files: normalizedFiles,
      });

      return {
        message: 'Book created successfully',
        data: result,
      };
    } catch (error: unknown) {
      let message = 'Something went wrong while creating the book';
      if (error instanceof Error) message = error.message;

      throw new HttpException({ message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

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
    description: 'Updates the details of a specific book, allowing metadata and uploaded files to be replaced.',
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
      message: 'Book updated successfully',
      updatedBook: updated,
    };
  }

  @Role(RoleTypes.ADMIN)
  @Get('auth')
  async findAllAuth(@Query() query: FindAllBookQueryParam): Promise<FindAllBookResponse> {
    return this.booksService.findAll(query);
  }

  /**
   * Retrieves all books with support for pagination, filtering, sorting, and visibility control.
   *
   * ### Features
   * - Pagination (`page`, `limit`)
   * - Sorting (`sortBy`, `sortOrder`)
   * - Filtering (`genre`, `format`, `availability`, `authorName`, etc.)
   * - Visibility control (`public`, `private`, `draft`)
   * - Archival toggle (`includeArchived`)
   *
   * ### Example
   * ```
   * GET /books?page=2&limit=5&sortBy=title&sortOrder=ASC&genre=fiction
   * ```
   */
  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retrieve all books with pagination, filtering, and sorting',
    description: 'Returns a paginated list of books filtered and sorted according to query parameters.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved paginated list of books.',
    schema: {
      example: {
        meta: {
          total: 42,
          totalPages: 5,
          page: 1,
          limit: 10,
          hasNextPage: true,
          hasPreviousPage: false,
        },
        data: [
          {
            id: 1,
            title: 'The Magic Pages: Adventures Begin',
            authorName: 'John Doe',
            genre: 'Fantasy',
            format: 'PDF',
            price: 199.99,
            rating: 4.7,
            visibility: 'public',
            createdAt: '2025-10-10T12:00:00Z',
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters or database error.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 10,
    description: 'Number of items per page (max: 50)',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['title', 'price', 'createdAt', 'rating'],
    example: 'createdAt',
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['ASC', 'DESC'],
    example: 'DESC',
    description: 'Sort direction',
  })
  @ApiQuery({ name: 'genre', required: false, type: String, description: 'Filter by book genre' })
  @ApiQuery({ name: 'format', required: false, type: String, description: 'Filter by book format (e.g., PDF, EPUB)' })
  @ApiQuery({ name: 'availability', required: false, type: String, description: 'Filter by book availability' })
  @ApiQuery({
    name: 'authorName',
    required: false,
    type: String,
    description: 'Filter by partial author name (case-insensitive)',
  })
  @ApiQuery({ name: 'minPrice', required: false, type: Number, description: 'Minimum price filter' })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number, description: 'Maximum price filter' })
  @ApiQuery({ name: 'minRating', required: false, type: Number, description: 'Minimum rating filter' })
  @ApiQuery({ name: 'maxRating', required: false, type: Number, description: 'Maximum rating filter' })
  @ApiQuery({
    name: 'includeArchived',
    required: false,
    type: Boolean,
    example: false,
    description: 'Include archived books in results',
  })
  @ApiQuery({
    name: 'visibility',
    required: false,
    enum: ['public', 'private', 'draft'],
    example: 'public',
    description: 'Book visibility level',
  })
  async findAll(@Query() query: FindAllBookQueryParam): Promise<FindAllBookResponse> {
    return this.booksService.findAll(query);
  }

  @Get('/auth/:id')
  findOneAuth(@Param('id', ParseIntPipe) id: number) {
    return this.booksService.findOne(id, { includeArchived: true, includePrivate: true });
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.booksService.findOne(id, {});
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
