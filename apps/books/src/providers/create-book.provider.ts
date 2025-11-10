import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// entities
import { Book } from '@app/contract/books/entities/book.entity';
import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';

@Injectable()
export class CreateBookProvider {
  constructor(
    /**
     * Inject bookRepository
     * */
    @InjectRepository(Book)
    private readonly bookRepository: Repository<Book>,
  ) { }

  public async createBook(createBookDto: CreateBookDto) {
    const bookCreate = this.bookRepository.create(createBookDto);

    return await this.bookRepository.save(bookCreate);
  }
}
