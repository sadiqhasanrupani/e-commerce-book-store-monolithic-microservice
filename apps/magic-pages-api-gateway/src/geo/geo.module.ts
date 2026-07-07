import { Module } from '@nestjs/common';

// Entity
import { Country } from '@app/contract/wishlist/geo/entities/country.entity';
import { State } from '@app/contract/wishlist/geo/entities/state.entity';
import { City } from '@app/contract/wishlist/geo/entities/city.entity';
import { PostalCode } from '@app/contract/wishlist/geo/entities/postal_code.entity';

// controller
import { CountryController } from './controllers/country.controller';
import { StateController } from './controllers/state.controller';
import { CityController } from './controllers/city.controller';
import { PincodeController } from './controllers/pincode.controller';

// providers
import { CountryProvider } from './providers/country.provider';
import { StateProvider } from './providers/state.provider';
import { CityProvider } from './providers/city.provider';
import { PincodeProvider } from './providers/pincode.provider';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Country, State, City, PostalCode])],
  controllers: [CountryController, StateController, CityController, PincodeController],
  providers: [CountryProvider, StateProvider, CityProvider, PincodeProvider],
  exports: [TypeOrmModule],
})
export class GeoModule { }
