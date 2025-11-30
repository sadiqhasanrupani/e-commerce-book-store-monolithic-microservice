import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgeGroup } from '@app/contract/age-groups/entities/age-group.entity';

@Injectable()
export class AgeGroupsService implements OnModuleInit {
  private readonly logger = new Logger(AgeGroupsService.name);

  constructor(
    @InjectRepository(AgeGroup)
    private readonly ageGroupRepository: Repository<AgeGroup>,
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
}
