import { Controller, Get, Param, Query, Ip, Headers } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiParam } from '@nestjs/swagger';
import { CategoriesService } from './providers/categories.service';
import { BooksService } from '../books/providers/books.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { FindAllBookQueryParam } from '@app/contract/books/types/find-book.type';
import { UserContextService } from '../auth/providers/user-context.service';
import { FindAllCategoriesDto } from '@app/contract/categories/dtos/find-all-categories.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly booksService: BooksService,
    private readonly userContextService: UserContextService,
  ) { }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Get()
  @ApiOperation({ summary: 'Get all categories' })
  async findAll(@Query() query: FindAllCategoriesDto) {
    return this.categoriesService.findAll(query);
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Get(':slug')
  @ApiOperation({ summary: 'Get category details' })
  @ApiParam({ name: 'slug', type: 'string', example: 'fiction' })
  async findOne(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Get(':slug/books')
  @ApiOperation({ summary: 'Get books by category' })
  @ApiParam({ name: 'slug', type: 'string', example: 'fiction' })
  async findBooksByCategory(
    @Param('slug') slug: string,
    @Query() query: FindAllBookQueryParam,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xForwardedFor: string,
  ) {
    // Ensure the category exists first
    await this.categoriesService.findBySlug(slug);

    // Override or set the category filter
    const queryParams = { ...query, categories: [slug] };

    const clientIp = xForwardedFor ? xForwardedFor.split(',')[0].trim() : ip;
    const userContext = this.userContextService.resolveContext(clientIp);

    return this.booksService.findAll(queryParams, { userContext });
  }
}
