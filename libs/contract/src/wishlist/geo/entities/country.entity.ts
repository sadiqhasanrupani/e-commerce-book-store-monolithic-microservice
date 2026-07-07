import { City } from './city.entity';
import { PostalCode } from './postal_code.entity';
import { State } from './state.entity';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('countries')
export class Country {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * ISO2 — this what the frontend will use
   * */
  @Column({ type: 'char', length: 2, name: 'iso2', nullable: false })
  iso2: string;

  @Column({ type: 'char', length: 3, name: 'iso3', nullable: true })
  iso3: string;

  @Column({ type: 'text', name: 'name', nullable: false })
  name: string;

  @Column({ type: 'text', name: 'pincode', nullable: true })
  phonecode: string;

  @Column({ type: 'text', name: 'currency', nullable: true })
  currency: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Foreign key area
   * */
  @OneToMany(() => State, (state) => state.country)
  state: State;

  @OneToMany(() => City, (city) => city.country)
  city: City;

  @OneToMany(() => PostalCode, (postalCode) => postalCode.country)
  postalCode: PostalCode;
}
