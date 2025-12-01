import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Book } from '@app/contract/books/entities/book.entity';
import { AgeGroup } from '@app/contract/age-groups/entities/age-group.entity';
import { AddBookToAgeGroupDto } from '@app/contract/book-age-groups/dtos/add-book-to-age-group.dto';
import { RemoveBookFromAgeGroupDto } from '@app/contract/book-age-groups/dtos/remove-book-from-age-group.dto';

@Injectable()
export class BookAgeGroupsService {
  private readonly logger = new Logger(BookAgeGroupsService.name);

  constructor(
    @InjectRepository(Book)
    private readonly bookRepository: Repository<Book>,
    @InjectRepository(AgeGroup)
    private readonly ageGroupRepository: Repository<AgeGroup>,
  ) { }

  async addBookToAgeGroup(dto: AddBookToAgeGroupDto): Promise<void> {
    const { bookId, ageGroupId } = dto;

    const book = await this.bookRepository.findOne({
      where: { id: bookId },
      relations: ['ageGroups'],
    });

    if (!book) {
      throw new NotFoundException(`Book with ID ${bookId} not found`);
    }

    const ageGroup = await this.ageGroupRepository.findOne({
      where: { id: ageGroupId },
    });

    if (!ageGroup) {
      throw new NotFoundException(`Age Group with ID ${ageGroupId} not found`);
    }

    // Check if already exists
    const exists = book.ageGroups.some((ag) => ag.id === ageGroupId);
    if (exists) {
      throw new BadRequestException(`Book is already in Age Group ${ageGroupId}`);
    }

    book.ageGroups.push(ageGroup);
    await this.bookRepository.save(book);

    this.logger.log(`Added book ${bookId} to age group ${ageGroupId}`);
  }

  async removeBookFromAgeGroup(dto: RemoveBookFromAgeGroupDto): Promise<void> {
    const { bookId, ageGroupId } = dto;

    const book = await this.bookRepository.findOne({
      where: { id: bookId },
      relations: ['ageGroups'],
    });

    if (!book) {
      throw new NotFoundException(`Book with ID ${bookId} not found`);
    }

    const initialLength = book.ageGroups.length;
    book.ageGroups = book.ageGroups.filter((ag) => ag.id !== ageGroupId);

    if (book.ageGroups.length === initialLength) {
      throw new BadRequestException(`Book is not in Age Group ${ageGroupId}`);
    }

    await this.bookRepository.save(book);

    this.logger.log(`Removed book ${bookId} from age group ${ageGroupId}`);
  }
}
