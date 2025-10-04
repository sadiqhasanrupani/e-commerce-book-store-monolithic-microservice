import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Book } from '@app/contract/books/entities/book.entity';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';

/**
 * Service responsible for handling all operations related to books,
 * including creation, retrieval, and updates.
 */
@Injectable()
export class BooksService {
  /**
   * Injecting the Book repository to interact with the database.
   */
  constructor(
    @InjectRepository(Book)
    private readonly bookRepository: Repository<Book>,
  ) {}

  /**
   * Create a new book entry in the database.
   *
   * @param data - Partial data for the new book. Can include any subset of the Book entity fields.
   * @returns The created Book entity.
   */
  async createBook(data: Partial<Book>): Promise<Book> {
    const newBook = this.bookRepository.create(data);
    return this.bookRepository.save(newBook);
  }

  /**
   * Retrieve all books from the database.
   *
   * @returns An array of all Book entities.
   */
  async getAllBook(): Promise<Book[]> {
    const allBook = await this.bookRepository.find();
    return allBook;
  }

  /**
   * Retrieve a single book by its ID.
   *
   * @param id - The ID of the book to retrieve.
   * @returns The Book entity if found, otherwise null.
   */
  async getBookById(id: number): Promise<Book | null> {
    return await this.bookRepository.findOneBy({ id });
  }

  /**
   * Update an existing book by its ID.
   *
   * This method first checks if the book exists. If not, it throws a NotFoundException.
   * If the book exists, it merges the new data from the UpdateBookDto into the existing entity
   * and saves the updated book back to the database.
   *
   * @param id - The ID of the book to update.
   * @param updateBookDto - The data to update the book with.
   * @returns The updated Book entity.
   *
   * @throws NotFoundException if the book with the given ID does not exist.
   */
  async updateBook(id: number, updateBookDto: UpdateBookDto): Promise<Book> {
    const book = await this.bookRepository.findOneBy({ id });

    if (!book) {
      throw new NotFoundException(`Book with ID ${id} not found`);
    }

    // Merge new data into existing book entity
    const updatedBook = this.bookRepository.merge(book, updateBookDto);

    return await this.bookRepository.save(updatedBook);
  }
}
