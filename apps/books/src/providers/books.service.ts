import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Book } from '@app/contract/books/entities/book.entity';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';


import { CreateBookProvider } from './create-book.provider';
import { UploadBookFilesProvider } from './upload-book-files.provider';

import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { BookAvailability } from '@app/contract/books/enums/book-avaliability.enum';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { BookGenre } from '@app/contract/books/enums/book-genres.enum';
import { CreateBookData } from '@app/contract/books/types/books.type';

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

const DUMMY_BOOK: Book = {
  id: 0,
  author: {
    id: 1,
    bio: "bio",
    birthDate: new Date(),
    books: [],
    name: 'bookName',
    createdAt: new Date(),
    updatedAt: new Date(),
    nationality: "Indian",
  },
  authorId: 1,
  authorName: "autherName",
  createdAt: new Date(),
  updatedAt: new Date(),
  availability: BookAvailability.IN_STOCK,
  fileUrl: [],
  format: BookFormat.EBOOK,
  genre: BookGenre.ART,
  snapshotUrl: ['something.png'],
  price: 90,
  publishedDate: new Date(),
  rating: 5,
  title: "bookTitle",
  description: "description",

}


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

  ) { }

  /**
   * Create a new book entry in the database.
   * Uploads the book image via Storage microservice if provided.
   *
   * @param data - Partial data for the new book. Can include any subset of the Book entity fields.
   * @param file - Optional file object containing buffer, filename, mimetype
   * @returns The created Book entity.
   */
  async createBook(
    data: CreateBookData
  ): Promise<Book> {

    try {
      const { createBookDto, files } = data;
      let urls: string[] = [];

      if (files?.files && files?.files?.length > 0) {
        urls = await this.uploadBookFilesProvider.uploadPdfs(files.files);
      }

      if (urls.length > 0) {

      }

      return await this.createBookProvider.createBook(createBookDto)

    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create book data',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }

  }

  /**
   * Retrieve all books from the database.
   *
   * @returns An array of all Book entities.
   */
  async getAllBooks(): Promise<Book[]> {
    const allBook = await this.bookRepository.find({
       
    });
    return allBook;

    return [];
  }

  /**
   * Retrieve a single book by its ID.
   *
   * @param id - The ID of the book to retrieve.
   * @returns The Book entity if found, otherwise null.
   */
  async getBookById(_id: number): Promise<Book | null> {
    // return await this.bookRepository.findOneBy({ id });

    return DUMMY_BOOK;
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
  async updateBook(_id: number, _updateBookDto: UpdateBookDto): Promise<Book> {
    // const book = await this.bookRepository.findOneBy({ id });
    //
    // if (!book) {
    //   throw new NotFoundException(`Book with ID ${id} not found`);
    // }
    //
    // // Merge new data into existing book entity
    // const updatedBook = this.bookRepository.merge(book, updateBookDto);
    //
    // return await this.bookRepository.save(updatedBook);
    //
    return DUMMY_BOOK;
  }

  async deleteBook(_id: number) {
    return 'delete book';
  }

  async putBook(_id: number, _data: any) {
    return '';
  }
}
