import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { UploadService } from './providers/upload.service';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';

@ApiTags('Admin Upload')
@ApiBearerAuth()
@Auth(AuthTypes.BEARER)
@Role(RoleTypes.ADMIN)
@Controller('admin/upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) { }

  @Post()
  @ApiOperation({ summary: 'Upload a file (Admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    const [url] = await this.uploadService.uploadFiles([file]);
    return { url };
  }
}
