import { Book } from '../entities/book.entity';
import { BookAvailability } from '../enums/book-avaliability.enum';
import { BookFormat } from '../enums/book-format.enum';
import { BookGenre } from '../enums/book-genres.enum';

export type FindAllBookQueryParam = {
  page?: number;
  limit?: number;
  sortBy?: keyof Book;
  sortOrder?: 'ASC' | 'DESC';
  genre?: BookGenre;
  formats?: BookFormat[];
  availability?: BookAvailability;
  authorName?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  maxRating?: number;
  includeArchived?: boolean;
  visibility?: 'public' | 'private' | 'draft';
};

export type PaginatedBook = {
  meta: {
    total: number;
    totalPages: number;
    page: number;
    limit: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  data: Book[];
};

export type FindAllBookResponse = {
  message: string;
} & PaginatedBook;

export type FindOneBookOption = { includeArchived?: boolean; includePrivate?: boolean };
