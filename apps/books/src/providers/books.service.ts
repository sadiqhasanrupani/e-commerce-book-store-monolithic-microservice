import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';

import { CreateBookProvider } from './create-book.provider';
import { UploadBookFilesProvider } from './upload-book-files.provider';

import { CreateBookData } from '@app/contract/books/types/books.type';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

import { Book } from '@app/contract/books/entities/book.entity';

/**
 * Service responsible for handling all operations related to books,
 * including creation, retrieval, and updates.
 */

/**
 * TODO
 * 1. Complete the book's get api
 * 2. Update book's api
 * 3. Delete book's api
 */

@Injectable()
export class BooksService {
  /**
   * Injecting the Book repository to interact with the database.
   */
  constructor(
    /**
     * Injecting createBookProvider
     * */
    private readonly createBookProvider: CreateBookProvider,

    /**
     * Injecting uploadBookFilesProvider
     * */
    private readonly uploadBookFilesProvider: UploadBookFilesProvider,

    /**
     * Inject userRepository
     * */
    @InjectRepository(Book)
    private readonly bookRepository: Repository<Book>,
  ) { } //eslint-disable-line

  /**
   * Create a new book entry in the database.
   * Uploads the book image via Storage microservice if provided.
   *
   * @param data - Partial data for the new book. Can include any subset of the Book entity fields.
   * @param file - Optional file object containing buffer, filename, mimetype
   * @returns The created Book entity.
   */
  async createBook(data: CreateBookData): Promise<Book> {
    try {
      const { createBookDto, files } = data;
      let url: string = '';

      if (files?.file) {
        url = await this.uploadBookFilesProvider.uploadPdf(files.file);
      }

      return await this.createBookProvider.createBook(createBookDto);
    } catch (error: unknown) {
      let message = 'Unknown error';

      if (error instanceof Error) {
        message = error.message;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create book data',
          error: message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Retrieve all books from the database.
   *
   * @returns An array of all Book entities.
   */
  async getAllBooks(): Promise<Book[]> {
    // const allBook = await this.bookRepository.find({});
    // return allBook;

    return Promise.resolve([]);
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

  async deleteBook(_id: number) { //eslint-disable-line
    return 'delete book';
  }

  async putBook(_id: number, _data: any) { //eslint-disable-line
    return '';
  }
}
