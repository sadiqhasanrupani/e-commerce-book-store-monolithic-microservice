import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AgeGroupsService } from './providers/age-groups.service';
import { AgeGroupDto } from '@app/contract/age-groups/dtos/age-group.dto';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';

@ApiTags('Age Groups')
@Controller('age-groups')
export class AgeGroupsController {
  constructor(private readonly ageGroupsService: AgeGroupsService) { }

  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @Get()
  @ApiOperation({ summary: 'Get all age groups' })
  @ApiResponse({
    status: 200,
    description: 'List of age groups',
    type: [AgeGroupDto],
  })
  async findAll() {
    const data = await this.ageGroupsService.findAll();
    return { data };
  }
}
