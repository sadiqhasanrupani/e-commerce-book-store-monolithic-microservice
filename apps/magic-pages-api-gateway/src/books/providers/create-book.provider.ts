import { Injectable, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Book } from '@app/contract/books/entities/book.entity';
import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';

@Injectable()
export class CreateBookProvider {
  constructor(
    @InjectRepository(Book)
    private readonly repo: Repository<Book>,
  ) { }

  /**
   * Create book with DB-level protection against race conditions.
   */
  public async createBook(dto: CreateBookDto): Promise<Book> {
    try {
      const entity = this.repo.create(dto);
      return await this.repo.save(entity);
    } catch (err) {
      // PostgreSQL duplicate key violation (title unique)
      if (err?.code === '23505') {
        throw new ConflictException(
          `A book with the title "${dto.title}" already exists (database constraint).`,
        );
      }

      throw new InternalServerErrorException(
        'Unexpected failure while saving the book.',
      );
    }
  }
}
