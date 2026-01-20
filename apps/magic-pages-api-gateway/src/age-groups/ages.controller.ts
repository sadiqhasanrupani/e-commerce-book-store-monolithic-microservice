import { Controller, Get, Param, Query, Ip, Headers } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiParam } from '@nestjs/swagger';
import { BooksService } from '../books/providers/books.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { FindAllBookQueryParam } from '@app/contract/books/types/find-book.type';
import { UserContextService } from '../auth/providers/user-context.service';

@ApiTags('Browse by Age')
@Controller('ages')
export class AgesController {
  constructor(
    private readonly booksService: BooksService,
    private readonly userContextService: UserContextService,
  ) { }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Get(':ageGroup/books')
  @ApiOperation({ summary: 'Get books by age group' })
  @ApiParam({ name: 'ageGroup', type: 'string', example: '3-5' })
  async findBooksByAgeGroup(
    @Param('ageGroup') ageGroup: string,
    @Query() query: FindAllBookQueryParam,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xForwardedFor: string,
  ) {
    // Override or set the age group filter
    const queryParams = {
      ...query,
      ageGroups: [ageGroup],
      page: query.page ?? 1,
      limit: query.limit ?? 10,
    };

    const clientIp = xForwardedFor ? xForwardedFor.split(',')[0].trim() : ip;
    const userContext = this.userContextService.resolveContext(clientIp);

    return this.booksService.findAll(queryParams, { userContext });
  }
}
