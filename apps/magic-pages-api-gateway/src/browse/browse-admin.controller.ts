import { Controller, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { BrowseService } from './providers/browse.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { CreateBrowseFormatDto } from '@app/contract/browse/dtos/create-browse-format.dto';
import { UpdateBrowseFormatDto } from '@app/contract/browse/dtos/update-browse-format.dto';
import { CreateBrowseCollectionDto } from '@app/contract/browse/dtos/create-browse-collection.dto';
import { UpdateBrowseCollectionDto } from '@app/contract/browse/dtos/update-browse-collection.dto';
import { BulkCreateBrowseFormatDto } from '@app/contract/browse/dtos/bulk-create-browse-format.dto';
import { BulkUpdateBrowseFormatDto } from '@app/contract/browse/dtos/bulk-update-browse-format.dto';
import { BulkCreateBrowseCollectionDto } from '@app/contract/browse/dtos/bulk-create-browse-collection.dto';
import { BulkUpdateBrowseCollectionDto } from '@app/contract/browse/dtos/bulk-update-browse-collection.dto';
import { BulkDeleteDto } from '@app/contract/browse/dtos/bulk-delete.dto';

@ApiTags('Browse Admin')
@ApiBearerAuth()
@Controller('browse')
export class BrowseAdminController {
  constructor(private readonly browseService: BrowseService) { }

  // --- Formats ---

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Post('formats')
  @ApiOperation({ summary: 'Create a browse format' })
  @ApiBody({ type: CreateBrowseFormatDto })
  async createFormat(@Body() createBrowseFormatDto: CreateBrowseFormatDto) {
    return this.browseService.createFormat(createBrowseFormatDto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Post('formats/bulk')
  @ApiOperation({ summary: 'Bulk create browse formats' })
  @ApiBody({ type: BulkCreateBrowseFormatDto })
  async bulkCreateFormats(@Body() dto: BulkCreateBrowseFormatDto) {
    return this.browseService.bulkCreateFormats(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put('formats/bulk')
  @ApiOperation({ summary: 'Bulk update browse formats' })
  @ApiBody({ type: BulkUpdateBrowseFormatDto })
  async bulkUpdateFormats(@Body() dto: BulkUpdateBrowseFormatDto) {
    return this.browseService.bulkUpdateFormats(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Delete('formats/bulk')
  @ApiOperation({ summary: 'Bulk delete browse formats' })
  @ApiBody({ type: BulkDeleteDto })
  async bulkDeleteFormats(@Body() dto: BulkDeleteDto) {
    return this.browseService.bulkDeleteFormats(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put('formats/:id')
  @ApiOperation({ summary: 'Update a browse format' })
  @ApiBody({ type: UpdateBrowseFormatDto })
  async updateFormat(@Param('id') id: string, @Body() updateBrowseFormatDto: UpdateBrowseFormatDto) {
    return this.browseService.updateFormat(id, updateBrowseFormatDto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Delete('formats/:id')
  @ApiOperation({ summary: 'Delete a browse format' })
  async deleteFormat(@Param('id') id: string) {
    return this.browseService.deleteFormat(id);
  }

  // --- Collections ---

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Post('collections')
  @ApiOperation({ summary: 'Create a browse collection' })
  @ApiBody({ type: CreateBrowseCollectionDto })
  async createCollection(@Body() createBrowseCollectionDto: CreateBrowseCollectionDto) {
    return this.browseService.createCollection(createBrowseCollectionDto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Post('collections/bulk')
  @ApiOperation({ summary: 'Bulk create browse collections' })
  @ApiBody({ type: BulkCreateBrowseCollectionDto })
  async bulkCreateCollections(@Body() dto: BulkCreateBrowseCollectionDto) {
    return this.browseService.bulkCreateCollections(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put('collections/bulk')
  @ApiOperation({ summary: 'Bulk update browse collections' })
  @ApiBody({ type: BulkUpdateBrowseCollectionDto })
  async bulkUpdateCollections(@Body() dto: BulkUpdateBrowseCollectionDto) {
    return this.browseService.bulkUpdateCollections(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Delete('collections/bulk')
  @ApiOperation({ summary: 'Bulk delete browse collections' })
  @ApiBody({ type: BulkDeleteDto })
  async bulkDeleteCollections(@Body() dto: BulkDeleteDto) {
    return this.browseService.bulkDeleteCollections(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put('collections/:id')
  @ApiOperation({ summary: 'Update a browse collection' })
  @ApiBody({ type: UpdateBrowseCollectionDto })
  async updateCollection(@Param('id') id: string, @Body() updateBrowseCollectionDto: UpdateBrowseCollectionDto) {
    return this.browseService.updateCollection(id, updateBrowseCollectionDto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Delete('collections/:id')
  @ApiOperation({ summary: 'Delete a browse collection' })
  async deleteCollection(@Param('id') id: string) {
    return this.browseService.deleteCollection(id);
  }
}
