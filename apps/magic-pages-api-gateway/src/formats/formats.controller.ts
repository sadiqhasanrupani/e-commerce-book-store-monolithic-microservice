import { Controller, Get, Param, Query } from '@nestjs/common';
import { FormatsService } from './providers/formats.service';
import { FindAllBookQueryParam } from '@app/contract/books/types/find-book.type';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';

@ApiTags('Formats')
@Controller('formats')
export class FormatsController {
  constructor(private readonly formatsService: FormatsService) { }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Fetch all book formats' })
  @ApiResponse({ status: 200, description: 'List of all available book formats.' })
  @Get()
  async findAll() {
    return this.formatsService.findAll();
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Fetch books by format' })
  @ApiResponse({ status: 200, description: 'Paginated list of books for the specified format.' })
  @Get(':formatId/books')
  async findBooksByFormat(
    @Param('formatId') formatId: string,
    @Query() query: FindAllBookQueryParam,
  ) {
    return this.formatsService.findBooksByFormat(formatId, query);
  }
}
