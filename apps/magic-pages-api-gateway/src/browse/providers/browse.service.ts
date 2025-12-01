import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AgeGroupsService } from '../../age-groups/providers/age-groups.service';
import { CategoriesService } from '../../categories/providers/categories.service';
import { BrowseFormat } from '@app/contract/browse/entities/browse-format.entity';
import { BrowseCollection } from '@app/contract/browse/entities/browse-collection.entity';
import { CreateBrowseFormatDto } from '@app/contract/browse/dtos/create-browse-format.dto';
import { UpdateBrowseFormatDto } from '@app/contract/browse/dtos/update-browse-format.dto';
import { CreateBrowseCollectionDto } from '@app/contract/browse/dtos/create-browse-collection.dto';
import { UpdateBrowseCollectionDto } from '@app/contract/browse/dtos/update-browse-collection.dto';
import { BulkCreateBrowseFormatDto } from '@app/contract/browse/dtos/bulk-create-browse-format.dto';
import { BulkUpdateBrowseFormatDto } from '@app/contract/browse/dtos/bulk-update-browse-format.dto';
import { BulkCreateBrowseCollectionDto } from '@app/contract/browse/dtos/bulk-create-browse-collection.dto';
import { BulkUpdateBrowseCollectionDto } from '@app/contract/browse/dtos/bulk-update-browse-collection.dto';
import { BulkDeleteDto } from '@app/contract/browse/dtos/bulk-delete.dto';

@Injectable()
export class BrowseService {
  constructor(
    private readonly ageGroupsService: AgeGroupsService,
    private readonly categoriesService: CategoriesService,
    @InjectRepository(BrowseFormat)
    private readonly formatRepository: Repository<BrowseFormat>,
    @InjectRepository(BrowseCollection)
    private readonly collectionRepository: Repository<BrowseCollection>,
    private readonly dataSource: DataSource,
  ) { }

  async getMetadata() {
    const [ageGroups, categories, formats, collections] = await Promise.all([
      this.ageGroupsService.findAll(),
      this.categoriesService.findAll({}),
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

  // --- Bulk Operations for Formats ---

  async bulkCreateFormats(dto: BulkCreateBrowseFormatDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const formats = this.formatRepository.create(dto.formats);
      const savedFormats = await queryRunner.manager.save(formats);
      await queryRunner.commitTransaction();
      return savedFormats;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Failed to bulk create formats');
    } finally {
      await queryRunner.release();
    }
  }

  async bulkUpdateFormats(dto: BulkUpdateBrowseFormatDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Fetch existing entities to ensure they exist
      const ids = dto.formats.map(f => f.id);
      const existingFormats = await queryRunner.manager.findByIds(BrowseFormat, ids);

      if (existingFormats.length !== ids.length) {
        throw new NotFoundException('One or more formats not found');
      }

      // Map updates
      const updates = dto.formats.map(updateDto => {
        const format = existingFormats.find(f => f.id === updateDto.id);
        if (format) {
          Object.assign(format, updateDto);
        }
        return format;
      }).filter((f): f is BrowseFormat => !!f);

      const savedFormats = await queryRunner.manager.save(updates);
      await queryRunner.commitTransaction();
      return savedFormats;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async bulkDeleteFormats(dto: BulkDeleteDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.delete(BrowseFormat, dto.ids);
      await queryRunner.commitTransaction();
      return { message: 'Formats deleted successfully' };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Failed to bulk delete formats');
    } finally {
      await queryRunner.release();
    }
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

  // --- Bulk Operations for Collections ---

  async bulkCreateCollections(dto: BulkCreateBrowseCollectionDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const collections = this.collectionRepository.create(dto.collections);
      const savedCollections = await queryRunner.manager.save(collections);
      await queryRunner.commitTransaction();
      return savedCollections;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Failed to bulk create collections');
    } finally {
      await queryRunner.release();
    }
  }

  async bulkUpdateCollections(dto: BulkUpdateBrowseCollectionDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const ids = dto.collections.map(c => c.id);
      const existingCollections = await queryRunner.manager.findByIds(BrowseCollection, ids);

      if (existingCollections.length !== ids.length) {
        throw new NotFoundException('One or more collections not found');
      }

      const updates = dto.collections.map(updateDto => {
        const collection = existingCollections.find(c => c.id === updateDto.id);
        if (collection) {
          Object.assign(collection, updateDto);
        }
        return collection;
      }).filter((c): c is BrowseCollection => !!c);

      const savedCollections = await queryRunner.manager.save(updates);
      await queryRunner.commitTransaction();
      return savedCollections;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async bulkDeleteCollections(dto: BulkDeleteDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.delete(BrowseCollection, dto.ids);
      await queryRunner.commitTransaction();
      return { message: 'Collections deleted successfully' };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Failed to bulk delete collections');
    } finally {
      await queryRunner.release();
    }
  }
}
