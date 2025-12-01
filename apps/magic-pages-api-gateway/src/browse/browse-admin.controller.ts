import { Controller, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BrowseService } from './providers/browse.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { BrowseFormat } from '@app/contract/browse/entities/browse-format.entity';
import { BrowseCollection } from '@app/contract/browse/entities/browse-collection.entity';

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
  async createFormat(@Body() data: Partial<BrowseFormat>) {
    return this.browseService.createFormat(data);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put('formats/:id')
  @ApiOperation({ summary: 'Update a browse format' })
  async updateFormat(@Param('id') id: string, @Body() data: Partial<BrowseFormat>) {
    return this.browseService.updateFormat(id, data);
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
  async createCollection(@Body() data: Partial<BrowseCollection>) {
    return this.browseService.createCollection(data);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put('collections/:id')
  @ApiOperation({ summary: 'Update a browse collection' })
  async updateCollection(@Param('id') id: string, @Body() data: Partial<BrowseCollection>) {
    return this.browseService.updateCollection(id, data);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Delete('collections/:id')
  @ApiOperation({ summary: 'Delete a browse collection' })
  async deleteCollection(@Param('id') id: string) {
    return this.browseService.deleteCollection(id);
  }
}
