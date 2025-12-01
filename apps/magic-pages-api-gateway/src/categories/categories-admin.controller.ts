import { Controller, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { CategoriesService } from './providers/categories.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { CreateCategoryDto } from '@app/contract/categories/dtos/create-category.dto';
import { UpdateCategoryDto } from '@app/contract/categories/dtos/update-category.dto';

@ApiTags('Categories Admin')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesAdminController {
  constructor(private readonly categoriesService: CategoriesService) { }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Create a category' })
  @ApiBody({ type: CreateCategoryDto })
  async create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoriesService.create(createCategoryDto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put(':id')
  @ApiOperation({ summary: 'Update a category' })
  @ApiBody({ type: UpdateCategoryDto })
  async update(@Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto) {
    return this.categoriesService.update(id, updateCategoryDto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a category' })
  async delete(@Param('id') id: string) {
    return this.categoriesService.delete(id);
  }
}
