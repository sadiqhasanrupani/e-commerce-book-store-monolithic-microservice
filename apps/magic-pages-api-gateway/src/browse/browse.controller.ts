import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BrowseService } from './providers/browse.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';

@ApiTags('Browse Hub')
@Controller('browse')
export class BrowseController {
  constructor(private readonly browseService: BrowseService) { }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Get('metadata')
  @ApiOperation({ summary: 'Get browse metadata' })
  async getMetadata() {
    return this.browseService.getMetadata();
  }
}
