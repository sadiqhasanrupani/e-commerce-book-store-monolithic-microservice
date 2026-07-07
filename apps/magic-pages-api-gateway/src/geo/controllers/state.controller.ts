import { Controller, Get } from '@nestjs/common';
import { StateProvider } from '../providers/state.provider';

@Controller('/geo/state')
export class StateController {
  constructor(
    /**
     * Inject countryProvider
     * */
    private readonly stateProvider: StateProvider
  ) { }

  @Get()
  public async getCountries(countryCode: string) {
    return await this.stateProvider.getStates(countryCode);
  }
}

