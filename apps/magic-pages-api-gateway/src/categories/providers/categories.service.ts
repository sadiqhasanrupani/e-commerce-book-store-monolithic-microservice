import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '@app/contract/books/entities/categories.entity';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) { }

  async findAll() {
    return this.categoryRepository.find({
      relations: ['children'],
    });
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
}
