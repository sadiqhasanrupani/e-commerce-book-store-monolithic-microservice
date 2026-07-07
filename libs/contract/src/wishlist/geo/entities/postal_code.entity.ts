import { Country } from './country.entity';
import { State } from './state.entity';
import { City } from './city.entity';

import { Entity, PrimaryGeneratedColumn, Column, JoinColumn, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('postal_codes')
export class PostalCode {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'text' })
  code: string;

  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'boolean' })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Foreign keys
   **/
  @ManyToOne(() => Country, (country) => country.postalCode)
  @JoinColumn({ name: 'country_id' })
  country: Country;

  @ManyToOne(() => State, (state) => state.postalCode)
  @JoinColumn({ name: 'state_id' })
  state: State;

  @ManyToOne(() => City, (city) => city.postalCode)
  @JoinColumn({ name: 'city_id' })
  city: City;
}
