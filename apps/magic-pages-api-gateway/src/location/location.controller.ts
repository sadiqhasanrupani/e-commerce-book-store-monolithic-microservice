import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LocationService } from './providers/location.service';
import { Auth } from '../auth/decorator/auth.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { Role } from '../auth/decorator/role.decorator';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';

@ApiTags('Location Metadata')
@Controller('meta/locations')
export class LocationController {
  constructor(private readonly locationService: LocationService) { }

  @Get('countries')
  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Get all countries' })
  getCountries() {
    return this.locationService.getCountries();
  }

  @Get('states/:countryIsoCode')
  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Get states by country ISO code' })
  getStates(@Param('countryIsoCode') countryIsoCode: string) {
    return this.locationService.getStates(countryIsoCode);
  }

  @Get('cities/:countryIsoCode/:stateIsoCode')
  @Auth(AuthTypes.NONE)
  @Role(RoleTypes.NONE)
  @ApiOperation({ summary: 'Get cities by country and state ISO codes' })
  getCities(
    @Param('countryIsoCode') countryIsoCode: string,
    @Param('stateIsoCode') stateIsoCode: string,
  ) {
    return this.locationService.getCities(countryIsoCode, stateIsoCode);
  }
}
