import { Controller, Post, Delete, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { BookAgeGroupsService } from './providers/book-age-groups.service';
import { AddBookToAgeGroupDto } from '@app/contract/book-age-groups/dtos/add-book-to-age-group.dto';
import { RemoveBookFromAgeGroupDto } from '@app/contract/book-age-groups/dtos/remove-book-from-age-group.dto';

@ApiTags('Book Age Groups')
@ApiBearerAuth()
@Auth(AuthTypes.BEARER)
@Role(RoleTypes.ADMIN)
@Controller('book-age-groups')
export class BookAgeGroupsAdminController {
  constructor(private readonly bookAgeGroupsService: BookAgeGroupsService) { }

  @Post()
  @ApiOperation({ summary: 'Add a book to an age group' })
  @ApiResponse({ status: 201, description: 'Book added to age group successfully.' })
  @ApiResponse({ status: 404, description: 'Book or Age Group not found.' })
  @ApiResponse({ status: 400, description: 'Book already in Age Group.' })
  async addBookToAgeGroup(@Body() dto: AddBookToAgeGroupDto): Promise<void> {
    return this.bookAgeGroupsService.addBookToAgeGroup(dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a book from an age group' })
  @ApiResponse({ status: 204, description: 'Book removed from age group successfully.' })
  @ApiResponse({ status: 404, description: 'Book not found.' })
  @ApiResponse({ status: 400, description: 'Book not in Age Group.' })
  async removeBookFromAgeGroup(@Body() dto: RemoveBookFromAgeGroupDto): Promise<void> {
    return this.bookAgeGroupsService.removeBookFromAgeGroup(dto);
  }
}
