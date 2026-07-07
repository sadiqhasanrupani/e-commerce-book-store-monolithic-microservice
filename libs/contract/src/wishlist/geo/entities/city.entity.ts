import { Entity, PrimaryGeneratedColumn, Column, JoinColumn, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Country } from './country.entity';
import { State } from './state.entity';
import { PostalCode } from './postal_code.entity';

@Entity('city')
export class City {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * City will eventually have one one state and one country so it make sense to add join Column
   * here in country and also inside the state.
   * */
  @OneToMany(() => Country, (country) => country.city)
  @JoinColumn({ name: 'country_id' })
  country: Country; // for fas lookup we are adding this country as well

  @OneToMany(() => State, (state) => state.city)
  @JoinColumn({ name: 'state_id' })
  state: State;

  @OneToMany(() => PostalCode, (postalCode) => postalCode.city)
  @JoinColumn({ name: 'postal_code_id' })
  postalCode: PostalCode;

  @Column({ type: 'text', nullable: false })
  name: string;

  @Column({ type: 'text', name: 'longitude' })
  longitude: string;

  @Column({ type: 'text', name: 'latitude' })
  latitude: string;

  /**
   * We also need population field so that it can help when we are applying search
   * funcitonality inside the frontend — basically it will help frontend to get the data
   * based on the population metrix.
   * */
  @Column({ type: 'bigint', name: 'population', nullable: true })
  population: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
