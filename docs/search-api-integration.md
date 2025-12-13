# Search API Integration Guide

This guide details the new Search API implemented in the backend and provides instructions for frontend integration.

## Overview

The search functionality allows users to search for books by title, author, and description. It uses **Postgres Full-Text Search** for high-performance matching and falls back to **Trigram Similarity (Fuzzy Search)** to handle typos and partial matches.

## API Specification

### Endpoint

`GET /books/search`

### Request Parameters

| Parameter | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `q` | `string` | Yes | The search query. Supports natural language. | `Harry Potter` |
| `page` | `number` | No | Page number (1-based). Default: `1`. | `1` |
| `limit` | `number` | No | Items per page. Default: `10`. Max: `50`. | `20` |
| `sortBy` | `string` | No | Sort field. Default: `relevance` (if `q` is present), else `createdAt`. | `relevance`, `price`, `newest` |
| `sortOrder`| `string` | No | Sort direction. `ASC` or `DESC`. Default: `DESC`. | `ASC` |
| `filters` | `json` | No | (Future) Complex filters. Currently supports specific query params below. | |
| `genre` | `string` | No | Filter by genre. | `Fantasy` |
| `minPrice` | `number` | No | Filter by minimum price. | `10` |
| `maxPrice` | `number` | No | Filter by maximum price. | `50` |

### Response Structure

```typescript
interface SearchResponse {
  data: Book[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  facets: {
    ageGroups: Array<{ id: string; count: number }>;
    categories: Array<{ id: string; name: string; count: number }>;
    formats: Array<{ id: string; count: number }>;
    genres: Array<{ label: string; value: string; count: number }>;
  };
}
```

### Example Request

```bash
curl "http://localhost:3000/books/search?q=Harry%20Poter&limit=5"
```

### Example Response

```json
{
  "data": [
    {
      "id": "book-uuid-1",
      "title": "Harry Potter and the Philosopher's Stone",
      "authorName": "J.K. Rowling",
      "description": "...",
      "coverImageUrl": "...",
      "variants": [...]
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 5,
    "totalPages": 1
  },
  "facets": {
    "genres": [
      { "label": "Fantasy", "value": "Fantasy", "count": 1 }
    ]
  }
}
```

## Frontend Integration Steps

### 1. Update API Client (`books.api.ts`)

Add the `searchBooks` method to your API service.

```typescript
// books.api.ts

export interface SearchBooksParams {
  q: string;
  page?: number;
  limit?: number;
  sortBy?: 'relevance' | 'price' | 'newest' | 'rating';
  genre?: string;
  // ... other filters
}

export const searchBooks = async (params: SearchBooksParams): Promise<SearchResponse> => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.append(key, String(value));
    }
  });

  const response = await fetch(\`/api/books/search?\${query.toString()}\`);
  if (!response.ok) {
    throw new Error('Failed to search books');
  }
  return response.json();
};
```

### 2. Create React Query Hook (`useSearchBooks.ts`)

Use `useQuery` to manage search state.

```typescript
// useSearchBooks.ts
import { useQuery } from '@tanstack/react-query';
import { searchBooks, SearchBooksParams } from './books.api';

export const useSearchBooks = (params: SearchBooksParams, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['books', 'search', params],
    queryFn: () => searchBooks(params),
    enabled: enabled && !!params.q, // Only search if query is present
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    keepPreviousData: true, // Keep showing previous results while fetching new ones
  });
};
```

### 3. Implement Search UI

- **Search Bar**: Input field that updates the `q` parameter (debounced).
- **Results List**: Display books from `data`.
- **Facets Sidebar**: Render filters from `facets` object (e.g., list of genres with counts).
- **Sorting**: Dropdown to toggle `sortBy`.

## Key Features

- **Typos Handling**: "Harry Poter" will match "Harry Potter".
- **Relevance Sorting**: Exact matches appear before fuzzy matches.
- **Faceting**: Facet counts reflect the *current* search context (e.g., searching "Fantasy" shows only relevant genres).
