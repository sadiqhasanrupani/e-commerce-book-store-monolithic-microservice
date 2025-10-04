import { Controller, Get } from '@nestjs/common';
import { BooksService } from './books.service';
import { MessagePattern } from '@nestjs/microservices';
import { BOOK_PATTERNS } from '@app/contract/books/patterns/books.pattern';

@Controller()
export class BooksController {
  constructor(
    /**
     * Injecting BooksService to use its methods in the controller
     */
    private readonly booksService: BooksService
  ) {}

  @MessagePattern(BOOK_PATTERNS.CREATE)
  createBook(data: any) {
    return this.booksService.createBook(data);
  }

  @MessagePattern(BOOK_PATTERNS.GET_ALL)
  getAllBooks() {
    return this.booksService.getAllBooks();
  }

  @MessagePattern(BOOK_PATTERNS.GET_BY_ID)
  getBookById(id: number) {
    return this.booksService.getBookById(id);
  }

  @MessagePattern(BOOK_PATTERNS.UPDATE)
  updateBook(data: any) {
    const { id, updateData } = data;
    return this.booksService.updateBook(id, updateData);
  }

  @MessagePattern(BOOK_PATTERNS.DELETE)
  deleteBook(id: number) {
    return this.booksService.deleteBook(id);
  }

  @MessagePattern(BOOK_PATTERNS.PUT)
  putBook(data: any) {
    const { id, putData } = data;
    return this.booksService.putBook(id, putData);
  }
}
