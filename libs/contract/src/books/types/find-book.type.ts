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
  q?: string;
  ageGroups?: string[];
  categories?: string[];
  isFeatured?: boolean;
  isBestseller?: boolean;
  isNewRelease?: boolean;
};

import { BookResponseDto } from '../dtos/book-response.dto';

export type PaginatedBook = {
  meta: {
    total: number;
    totalPages: number;
    page: number;
    limit: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  data: BookResponseDto[];
  facets?: {
    ageGroups?: { id: string; count: number }[];
    categories?: { id: string; name: string; count: number }[];
    formats?: { id: string; count: number }[];
  };
};

export type FindAllBookResponse = {
  message: string;
} & PaginatedBook;

import { UserContext } from 'apps/magic-pages-api-gateway/src/auth/providers/user-context.service';

export interface FindOneBookOption {
  includeArchived?: boolean;
  includePrivate?: boolean;
  userContext?: UserContext;
}

export interface FindAllBookOptions {
  userContext?: UserContext;
  isAdmin?: boolean;
};
