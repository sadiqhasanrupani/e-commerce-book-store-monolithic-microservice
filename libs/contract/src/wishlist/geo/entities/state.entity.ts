import { Country } from './country.entity';
import { City } from './city.entity';
import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PostalCode } from './postal_code.entity';

@Entity('states')
export class State {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Foreign key area
   * */
  @ManyToOne(() => Country, (country) => country.state)
  /**
   * The reason why we add join column here is because
   * country can have multiple state but 
   * state only will have one country — so it make sense to add join column decorator
   * here, so that we can get the country id in state.
   * */
  @JoinColumn({ name: 'country_id' })
  country: Country;

  @ManyToOne(() => City, (city) => city.country)
  city: City;

  @ManyToOne(() => PostalCode, (postalCode) => postalCode.country)
  postalCode: PostalCode;

  @Column({ type: 'text', name: 'code' })
  code: string;

  @Column({ type: 'text', name: 'name' })
  name: string;

  @Column({ type: 'text', name: 'admin_level' })
  adminLevel: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
