import { Injectable, Inject } from '@nestjs/common';

import { ClientProxy } from '@nestjs/microservices';

import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';

import { BOOK_PATTERNS } from '@app/contract/books/patterns/books.pattern';
import { CreateBookData } from '@app/contract/books/types/books.type';
import { BOOKS_CONFIG } from '@app/contract/books/config/books.config';

@Injectable()
export class BooksService {
  constructor(
    /**
     * Inject clientProxy
     * */
    @Inject(BOOKS_CONFIG.CLIENTS.name)
    private readonly clientProxy: ClientProxy,
  ) { } // eslint-disable-line

  create(bookData: CreateBookData) {
    return this.clientProxy.send(BOOK_PATTERNS.CREATE, bookData);
  }

  findAll() {
    return { message: `This action returns all books` };
  }

  findOne(id: number) {
    return `This action returns a #${id} book`;
  }

  update(id: number, updateBookDto: UpdateBookDto) {
    return `This action updates a #${id} book`;
  }

  remove(id: number) {
    return `This action removes a #${id} book`;
  }
}
