import { Controller, Post, Put, Delete, Body, Param, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AgeGroupsService } from './providers/age-groups.service';
import { UploadService } from '../upload/providers/upload.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { CreateAgeGroupDto } from '@app/contract/age-groups/dtos/create-age-group.dto';
import { UpdateAgeGroupDto } from '@app/contract/age-groups/dtos/update-age-group.dto';
import { BulkCreateAgeGroupDto } from '@app/contract/age-groups/dtos/bulk-create-age-group.dto';
import { BulkUpdateAgeGroupDto } from '@app/contract/age-groups/dtos/bulk-update-age-group.dto';
import { BulkDeleteAgeGroupDto } from '@app/contract/age-groups/dtos/bulk-delete-age-group.dto';

@ApiTags('Age Groups Admin')
@ApiBearerAuth()
@Controller('age-groups')
export class AgeGroupsAdminController {
  constructor(
    private readonly ageGroupsService: AgeGroupsService,
    private readonly uploadService: UploadService,
  ) { }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Post()
  @UseInterceptors(FileInterceptor('heroImage'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create an age group' })
  @ApiBody({ type: CreateAgeGroupDto })
  async create(
    @Body() dto: CreateAgeGroupDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      const [url] = await this.uploadService.uploadFiles([file]);
      dto.heroImage = url;
    }
    return this.ageGroupsService.create(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Post('bulk')
  @ApiOperation({ summary: 'Bulk create age groups' })
  @ApiBody({ type: BulkCreateAgeGroupDto })
  async bulkCreate(@Body() dto: BulkCreateAgeGroupDto) {
    return this.ageGroupsService.bulkCreate(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put('bulk')
  @ApiOperation({ summary: 'Bulk update age groups' })
  @ApiBody({ type: BulkUpdateAgeGroupDto })
  async bulkUpdate(@Body() dto: BulkUpdateAgeGroupDto) {
    return this.ageGroupsService.bulkUpdate(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Delete('bulk')
  @ApiOperation({ summary: 'Bulk delete age groups' })
  @ApiBody({ type: BulkDeleteAgeGroupDto })
  async bulkDelete(@Body() dto: BulkDeleteAgeGroupDto) {
    return this.ageGroupsService.bulkDelete(dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Put(':id')
  @UseInterceptors(FileInterceptor('heroImage'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update an age group' })
  @ApiBody({ type: UpdateAgeGroupDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAgeGroupDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      const [url] = await this.uploadService.uploadFiles([file]);
      dto.heroImage = url;
    }
    return this.ageGroupsService.update(id, dto);
  }

  @Auth(AuthTypes.BEARER)
  @Role(RoleTypes.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an age group' })
  async delete(@Param('id') id: string) {
    return this.ageGroupsService.delete(id);
  }
}
