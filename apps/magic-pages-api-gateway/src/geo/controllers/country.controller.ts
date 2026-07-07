import { Controller, Get } from '@nestjs/common';
import { CountryProvider } from '../providers/country.provider';

@Controller('/geo/country')
export class CountryController {
  constructor(
    /**
     * Inject countryProvider
     * */
    private readonly countryProvider: CountryProvider
  ) { }

  @Get()
  public async getCountries() {
    return await this.countryProvider.getCountries()
  }
}
