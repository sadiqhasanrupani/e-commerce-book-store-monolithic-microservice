import { Controller, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { CategoriesService } from './providers/categories.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { CreateCategoryDto } from '@app/contract/categories/dtos/create-category.dto';
import { UpdateCategoryDto } from '@app/contract/categories/dtos/update-category.dto';
import { BulkCreateCategoryDto } from '@app/contract/categories/dtos/bulk-create-category.dto';
import { BulkUpdateCategoryDto } from '@app/contract/categories/dtos/bulk-update-category.dto';
import { BulkDeleteCategoryDto } from '@app/contract/categories/dtos/bulk-delete-category.dto';

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
  @Post('bulk')
  @ApiOperation({ summary: 'Bulk create categories' })
  @ApiBody({ type: BulkCreateCategoryDto })
  async bulkCreate(@Body() dto: BulkCreateCategoryDto) {
    return this.categoriesService.bulkCreate(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put('bulk')
  @ApiOperation({ summary: 'Bulk update categories' })
  @ApiBody({ type: BulkUpdateCategoryDto })
  async bulkUpdate(@Body() dto: BulkUpdateCategoryDto) {
    return this.categoriesService.bulkUpdate(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Delete('bulk')
  @ApiOperation({ summary: 'Bulk delete categories' })
  @ApiBody({ type: BulkDeleteCategoryDto })
  async bulkDelete(@Body() dto: BulkDeleteCategoryDto) {
    return this.categoriesService.bulkDelete(dto);
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
