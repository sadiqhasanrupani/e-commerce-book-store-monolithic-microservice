import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgeGroupsService } from '../../age-groups/providers/age-groups.service';
import { CategoriesService } from '../../categories/providers/categories.service';
import { BrowseFormat } from '@app/contract/browse/entities/browse-format.entity';
import { BrowseCollection } from '@app/contract/browse/entities/browse-collection.entity';
import { CreateBrowseFormatDto } from '@app/contract/browse/dtos/create-browse-format.dto';
import { UpdateBrowseFormatDto } from '@app/contract/browse/dtos/update-browse-format.dto';
import { CreateBrowseCollectionDto } from '@app/contract/browse/dtos/create-browse-collection.dto';
import { UpdateBrowseCollectionDto } from '@app/contract/browse/dtos/update-browse-collection.dto';

@Injectable()
export class BrowseService {
  constructor(
    private readonly ageGroupsService: AgeGroupsService,
    private readonly categoriesService: CategoriesService,
    @InjectRepository(BrowseFormat)
    private readonly formatRepository: Repository<BrowseFormat>,
    @InjectRepository(BrowseCollection)
    private readonly collectionRepository: Repository<BrowseCollection>,
  ) { }

  async getMetadata() {
    const [ageGroups, categories, formats, collections] = await Promise.all([
      this.ageGroupsService.findAll(),
      this.categoriesService.findAll(),
      this.formatRepository.find({ order: { sortOrder: 'ASC' } }),
      this.collectionRepository.find({ order: { sortOrder: 'ASC' } }),
    ]);

    return {
      ageGroups,
      categories,
      formats,
      collections,
    };
  }

  // --- Admin CRUD for Formats ---

  async createFormat(createBrowseFormatDto: CreateBrowseFormatDto) {
    const format = this.formatRepository.create(createBrowseFormatDto);
    return this.formatRepository.save(format);
  }

  async updateFormat(id: string, updateBrowseFormatDto: UpdateBrowseFormatDto) {
    const format = await this.formatRepository.findOneBy({ id });
    if (!format) throw new NotFoundException('Format not found');
    Object.assign(format, updateBrowseFormatDto);
    return this.formatRepository.save(format);
  }

  async deleteFormat(id: string) {
    const result = await this.formatRepository.delete(id);
    if (result.affected === 0) throw new NotFoundException('Format not found');
    return { message: 'Format deleted successfully' };
  }

  // --- Admin CRUD for Collections ---

  async createCollection(createBrowseCollectionDto: CreateBrowseCollectionDto) {
    const collection = this.collectionRepository.create(createBrowseCollectionDto);
    return this.collectionRepository.save(collection);
  }

  async updateCollection(id: string, updateBrowseCollectionDto: UpdateBrowseCollectionDto) {
    const collection = await this.collectionRepository.findOneBy({ id });
    if (!collection) throw new NotFoundException('Collection not found');
    Object.assign(collection, updateBrowseCollectionDto);
    return this.collectionRepository.save(collection);
  }

  async deleteCollection(id: string) {
    const result = await this.collectionRepository.delete(id);
    if (result.affected === 0) throw new NotFoundException('Collection not found');
    return { message: 'Collection deleted successfully' };
  }
}
