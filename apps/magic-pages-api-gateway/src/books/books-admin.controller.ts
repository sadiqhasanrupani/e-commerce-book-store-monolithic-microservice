import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Ip,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiParam } from '@nestjs/swagger';
import { BooksService } from './providers/books.service';
import { Role } from '../auth/decorator/role.decorator';

import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';
import { FindAllBookQueryParam, FindAllBookResponse } from '@app/contract/books/types/find-book.type';
import { UserContextService } from '../auth/providers/user-context.service';

@ApiTags('Books Admin')
@ApiBearerAuth()
@Role(RoleTypes.ADMIN)
@Controller('admin/books')
export class BooksAdminController {
  constructor(
    private readonly booksService: BooksService,
    private readonly userContextService: UserContextService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'List all books (Admin)' })
  @ApiResponse({ status: 200, description: 'Paginated book list' })
  async findAll(
    @Query() query: FindAllBookQueryParam,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xForwardedFor: string,
  ): Promise<FindAllBookResponse> {
    const clientIp = xForwardedFor ? xForwardedFor.split(',')[0].trim() : ip;
    const userContext = this.userContextService.resolveContext(clientIp);
    // Explicitly pass isAdmin if supported, or rely on service logic.
    // booksService.findAll takes (query, options). Options can have isAdmin.
    return this.booksService.findAll(query, { isAdmin: true, userContext });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new book' })
  @ApiBody({ type: CreateBookDto })
  async create(@Body() createBookDto: CreateBookDto) {
    // Note: This endpoint does not handle file uploads directly (multipart).
    // The requirement said: "Payload: Full book object including snapshots...".
    // If frontend uploads first then sends logic, this works.
    // If it needs multipart, I should replicate multipart logic from BooksController.
    // But requirement for admin/upload endpoint suggests 2-step process or similar?
    // "POST /admin/upload: Generic endpoint... Response { url }"
    // So admin panel likely uploads first, then sends URLs in JSON payload.
    // I will support JSON payload here as per requirement "Type: String[] (Array of image URLs)".
    // So simple Body() is correct.

    // BooksService.create expects CreateBookData { createBookDto, files }.
    // If no files, passing empty object.
    return this.booksService.create({ createBookDto, files: {} });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full details for editing' })
  async findOne(@Param('id') id: string) {
    return this.booksService.findOne(id, { isAdmin: true });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update book details' })
  async update(
    @Param('id') id: string,
    @Body() updateBookDto: UpdateBookDto,
  ) {
    // Similarly, assuming JSON payload with URLs.
    return this.booksService.updateBook(id, updateBookDto, {});
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete or archive' })
  async delete(@Param('id') id: string) {
    return this.booksService.deleteBook(id, { force: false, archivePrefix: 'archive/' });
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Quick toggle status' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isFeatured: { type: 'boolean' },
        isBestseller: { type: 'boolean' },
        visibility: { type: 'string', enum: ['public', 'private', 'draft'] }
      }
    }
  })
  async updateStatus(
    @Param('id') id: string,
    @Body() statusDto: Partial<UpdateBookDto>,
  ) {
    // Filter only allowed fields to be safe, or just pass to updateBook
    const allowed = ['isFeatured', 'isBestseller', 'visibility'];
    const payload: UpdateBookDto = {};
    let hasUpdate = false;
    for (const key of allowed) {
      if (key in statusDto) {
        (payload as any)[key] = (statusDto as any)[key];
        hasUpdate = true;
      }
    }

    if (!hasUpdate) return { message: 'No status changes provided' };

    return this.booksService.updateBook(id, payload, {});
  }
}
