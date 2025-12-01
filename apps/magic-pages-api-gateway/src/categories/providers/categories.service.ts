import { Injectable, Logger, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import { Category } from '@app/contract/books/entities/categories.entity';
import { CreateCategoryDto } from '@app/contract/categories/dtos/create-category.dto';
import { UpdateCategoryDto } from '@app/contract/categories/dtos/update-category.dto';
import { BulkCreateCategoryDto } from '@app/contract/categories/dtos/bulk-create-category.dto';
import { BulkUpdateCategoryDto } from '@app/contract/categories/dtos/bulk-update-category.dto';
import { BulkDeleteCategoryDto } from '@app/contract/categories/dtos/bulk-delete-category.dto';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    private readonly dataSource: DataSource,
  ) { }

  async findAll(query: { page?: number; limit?: number; parent_id?: string }) {
    const { page = 1, limit = 20, parent_id } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (parent_id) {
      where.parent = { id: parent_id };
    } else {
      where.parent = IsNull();
    }

    const [data, total] = await this.categoryRepository.findAndCount({
      where,
      relations: ['children'],
      skip,
      take: limit,
    });

    return {
      message: 'Categories retrieved successfully',
      data,
      meta: {
        itemsPerPage: limit,
        totalItems: total,
        currentPage: page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findBySlug(slug: string) {
    const category = await this.categoryRepository.findOne({
      where: { slug },
      relations: ['children'],
    });

    if (!category) {
      throw new NotFoundException(`Category with slug "${slug}" not found`);
    }

    return category;
  }
  async create(createCategoryDto: CreateCategoryDto) {
    const category = this.categoryRepository.create(createCategoryDto);
    return this.categoryRepository.save(category);
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto) {
    const category = await this.categoryRepository.findOneBy({ id });
    if (!category) throw new NotFoundException('Category not found');
    Object.assign(category, updateCategoryDto);
    return this.categoryRepository.save(category);
  }

  async delete(id: string) {
    const result = await this.categoryRepository.delete(id);
    if (result.affected === 0) throw new NotFoundException('Category not found');
    return { message: 'Category deleted successfully' };
  }

  // --- Bulk Operations ---

  async bulkCreate(dto: BulkCreateCategoryDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const categories = this.categoryRepository.create(dto.categories);
      const savedCategories = await queryRunner.manager.save(categories);
      await queryRunner.commitTransaction();
      return savedCategories;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Failed to bulk create categories');
    } finally {
      await queryRunner.release();
    }
  }

  async bulkUpdate(dto: BulkUpdateCategoryDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const ids = dto.categories.map(c => c.id);
      const existingCategories = await queryRunner.manager.findByIds(Category, ids);

      if (existingCategories.length !== ids.length) {
        throw new NotFoundException('One or more categories not found');
      }

      const updates = dto.categories.map(updateDto => {
        const category = existingCategories.find(c => c.id === updateDto.id);
        if (category) {
          Object.assign(category, updateDto);
        }
        return category;
      }).filter((c): c is Category => !!c);

      const savedCategories = await queryRunner.manager.save(updates);
      await queryRunner.commitTransaction();
      return savedCategories;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async bulkDelete(dto: BulkDeleteCategoryDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.delete(Category, dto.ids);
      await queryRunner.commitTransaction();
      return { message: 'Categories deleted successfully' };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Failed to bulk delete categories');
    } finally {
      await queryRunner.release();
    }
  }
}
