import { Injectable, Logger, OnModuleInit, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AgeGroup } from '@app/contract/age-groups/entities/age-group.entity';
import { CreateAgeGroupDto } from '@app/contract/age-groups/dtos/create-age-group.dto';
import { UpdateAgeGroupDto } from '@app/contract/age-groups/dtos/update-age-group.dto';
import { BulkCreateAgeGroupDto } from '@app/contract/age-groups/dtos/bulk-create-age-group.dto';
import { BulkUpdateAgeGroupDto } from '@app/contract/age-groups/dtos/bulk-update-age-group.dto';
import { BulkDeleteAgeGroupDto } from '@app/contract/age-groups/dtos/bulk-delete-age-group.dto';

@Injectable()
export class AgeGroupsService implements OnModuleInit {
  private readonly logger = new Logger(AgeGroupsService.name);

  constructor(
    @InjectRepository(AgeGroup)
    private readonly ageGroupRepository: Repository<AgeGroup>,
    private readonly dataSource: DataSource,
  ) { }

  async onModuleInit() {
    await this.seedDefaultAgeGroups();
  }

  private async seedDefaultAgeGroups() {
    const count = await this.ageGroupRepository.count();
    if (count > 0) return;

    this.logger.log('Seeding default age groups...');
    const defaults = [
      { id: '0-2', label: 'Ages 0-2', sortOrder: 1, description: 'Board books and high contrast for babies.' },
      { id: '3-5', label: 'Ages 3-5', sortOrder: 2, description: 'Picture books and early learning.' },
      { id: '5-7', label: 'Ages 5-7', sortOrder: 3, description: 'Early readers and first chapters.' },
      { id: '8-12', label: 'Ages 8-12', sortOrder: 4, description: 'Middle grade fiction and non-fiction.' },
      { id: 'teens', label: 'Teens', sortOrder: 5, description: 'Young adult novels.' },
    ];

    await this.ageGroupRepository.save(defaults);
    this.logger.log('Default age groups seeded.');
  }

  async findAll(): Promise<AgeGroup[]> {
    try {
      return await this.ageGroupRepository.find({
        order: {
          sortOrder: 'ASC',
        },
      });
    } catch (err) {
      this.logger.error('Failed to fetch age groups', err);
      throw err;
    }
  }

  // --- Admin CRUD ---

  async create(dto: CreateAgeGroupDto) {
    const ageGroup = this.ageGroupRepository.create(dto);
    return this.ageGroupRepository.save(ageGroup);
  }

  async update(id: string, dto: UpdateAgeGroupDto) {
    const ageGroup = await this.ageGroupRepository.findOneBy({ id });
    if (!ageGroup) throw new NotFoundException('Age group not found');
    Object.assign(ageGroup, dto);
    return this.ageGroupRepository.save(ageGroup);
  }

  async delete(id: string) {
    const result = await this.ageGroupRepository.delete(id);
    if (result.affected === 0) throw new NotFoundException('Age group not found');
    return { message: 'Age group deleted successfully' };
  }

  // --- Bulk Operations ---

  async bulkCreate(dto: BulkCreateAgeGroupDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const ageGroups = this.ageGroupRepository.create(dto.ageGroups);
      const savedAgeGroups = await queryRunner.manager.save(ageGroups);
      await queryRunner.commitTransaction();
      return savedAgeGroups;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Failed to bulk create age groups');
    } finally {
      await queryRunner.release();
    }
  }

  async bulkUpdate(dto: BulkUpdateAgeGroupDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const ids = dto.ageGroups.map(ag => ag.id);
      const existingAgeGroups = await queryRunner.manager.findByIds(AgeGroup, ids);

      if (existingAgeGroups.length !== ids.length) {
        throw new NotFoundException('One or more age groups not found');
      }

      const updates = dto.ageGroups.map(updateDto => {
        const ageGroup = existingAgeGroups.find(ag => ag.id === updateDto.id);
        if (ageGroup) {
          Object.assign(ageGroup, updateDto);
        }
        return ageGroup;
      }).filter((ag): ag is AgeGroup => !!ag);

      const savedAgeGroups = await queryRunner.manager.save(updates);
      await queryRunner.commitTransaction();
      return savedAgeGroups;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async bulkDelete(dto: BulkDeleteAgeGroupDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.delete(AgeGroup, dto.ids);
      await queryRunner.commitTransaction();
      return { message: 'Age groups deleted successfully' };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Failed to bulk delete age groups');
    } finally {
      await queryRunner.release();
    }
  }
}
