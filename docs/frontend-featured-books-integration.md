# Featured Books API Integration Guide

## Overview
This guide details how to integrate the new "Featured Books" API into the frontend application. The API provides a list of books that are marked as `isFeatured: true`.

## API Endpoint

**URL:** `/books/featured`
**Method:** `GET`
**Auth:** Public (No authentication required)

### Response Format
The response follows the standard paginated response structure but is pre-filtered for featured books.

```json
{
  "meta": {
    "total": 10,
    "totalPages": 1,
    "page": 1,
    "limit": 10,
    "hasNextPage": false,
    "hasPreviousPage": false
  },
  "data": [
    {
      "id": "uuid-string",
      "title": "The Rainbow Adventure",
      "authorName": "Sarah Johnson",
      "genre": "Story",
      "description": "...",
      "coverImageUrl": "https://...",
      "isFeatured": true,
      "price": 1299, // Note: Price might be on variant, check specific implementation
      "createdAt": "2023-01-01T00:00:00Z"
    }
    // ... more books
  ],
  "facets": {
    "ageGroups": [],
    "categories": [],
    "formats": []
  }
}
```

## Integration Steps

We follow a **Domain-Driven Design (DDD)** approach.

### 1. Global Providers

Ensure you have the Query Providers set up in `src/providers`.

```
src/providers
├── ClientQueryProvider.tsx
└── QueryProvider.tsx
```

### 2. Feature Structure

Organize the `books` feature as follows:

```
src/features/books
├── api
│   └── books.api.ts           # Raw API calls
├── components
│   └── featured-books-list.tsx # UI Components
├── hooks
│   ├── usePaginatedBooks.ts   # Hooks for pagination
│   └── useBooksQuery.ts       # Main React Query hook
├── service
│   └── books.service.ts       # Business logic / Data transformation
├── stores
│   └── books-filter.store.ts  # State management (e.g., filters)
├── types
│   ├── book.type.ts           # Domain types
│   └── query-params.type.ts   # API parameter types
└── utils
    └── as-record.util.ts      # Feature-specific utilities
```

### 3. Implementation Details

#### Types (`src/features/books/types/book.type.ts`)
```typescript
export interface Book {
  id: string;
  title: string;
  authorName: string;
  // ... other fields
  isFeatured: boolean;
}
```

#### API (`src/features/books/api/books.api.ts`)
```typescript
import { axios } from '@/lib/axios';
import { Book } from '../types/book.type';

export const fetchFeaturedBooks = async (): Promise<Book[]> => {
  const { data } = await axios.get('/books/featured');
  return data.data;
};
```

#### Service (`src/features/books/service/books.service.ts`)
```typescript
// Optional layer for data transformation or complex business logic
import * as booksApi from '../api/books.api';

export const getFeaturedBooks = async () => {
  return await booksApi.fetchFeaturedBooks();
};
```

#### Hooks (`src/features/books/hooks/useBooksQuery.ts`)
```typescript
import { useQuery } from '@tanstack/react-query';
import { getFeaturedBooks } from '../service/books.service';

export const useFeaturedBooksQuery = () => {
  return useQuery({
    queryKey: ['books', 'featured'],
    queryFn: getFeaturedBooks,
  });
};
```

#### Component (`src/features/books/components/featured-books-list.tsx`)
```tsx
import { useFeaturedBooksQuery } from '../hooks/useBooksQuery';

export const FeaturedBooksList = () => {
  const { data, isLoading } = useFeaturedBooksQuery();
  // ... render logic
};
```

### 2. Verification
- Ensure the endpoint returns only books with `isFeatured: true`.
