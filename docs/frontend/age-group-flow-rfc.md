# Frontend Implementation Guide: Age Group Flow

## 1. Overview
This document outlines the implementation details for the **Age Group Browsing Experience** in the e-commerce storefront. The goal is to allow users to browse books specifically curated for different age ranges (e.g., "0-2 Years", "3-5 Years").

## 2. User Flow

1.  **Discovery (Home Page / Navigation):**
    - Users see a list of Age Groups (e.g., as cards or a sidebar menu).
    - Each item displays the label (e.g., "0-2 Years") and optionally a hero image.
2.  **Selection:**
    - Clicking an Age Group navigates the user to the **Age Group Landing Page** (`/ages/:ageGroupId`).
3.  **Browsing (Age Group Page):**
    - **Hero Section:** Displays the Age Group's title, description, and hero image.
    - **Book Grid:** Displays a paginated list of books belonging to this age group.
    - **Filtering/Sorting:** Users can sort books (e.g., by Newest, Price) or filter by other attributes (optional).

## 3. API Integration

### 3.1. Fetch All Age Groups
Used for the navigation menu, home page sections, or filters.

- **Endpoint:** `GET /api/v1/age-groups`
- **Auth:** Public
- **Response:**
  ```json
  {
    "data": [
      {
        "id": "0-2",
        "label": "0-2 Years",
        "description": "Board books, cloth books, and high-contrast imagery for babies and toddlers.",
        "heroImage": "https://minio.magic-pages.com/magic-pages/age-groups/0-2-hero.jpg",
        "sortOrder": 1
      },
      {
        "id": "3-5",
        "label": "3-5 Years",
        "description": "Picture books, read-alouds, and early learning concepts.",
        "heroImage": "https://minio.magic-pages.com/magic-pages/age-groups/3-5-hero.jpg",
        "sortOrder": 2
      },
      {
        "id": "6-8",
        "label": "6-8 Years",
        "description": "Early readers, chapter books, and first graphic novels.",
        "heroImage": "https://minio.magic-pages.com/magic-pages/age-groups/6-8-hero.jpg",
        "sortOrder": 3
      }
    ]
  }
  ```

### 3.2. Fetch Books by Age Group
Used to populate the book grid on the Age Group Landing Page.

- **Endpoint:** `GET /api/v1/ages/:ageGroup/books`
- **Auth:** Public
- **Path Params:**
    - `ageGroup`: The ID of the age group (e.g., `0-2`).
- **Query Params:**
    - `page`: Page number (default: 1).
    - `limit`: Items per page (default: 10).
    - `sort`: Sort field (e.g., `createdAt`, `price`).
    - `order`: Sort order (`ASC` or `DESC`).
- **Response:**
  ```json
  {
    "data": [
      {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "title": "The Very Hungry Caterpillar",
        "subtitle": "A Classic Picture Book",
        "slug": "the-very-hungry-caterpillar",
        "authorName": "Eric Carle",
        "publisher": "World of Eric Carle",
        "publishedDate": "1969-06-03T00:00:00.000Z",
        "description": "The all-time classic picture book, from generation to generation, sold somewhere in the world every 30 seconds!",
        "longDescription": "A comprehensive story about a caterpillar who eats his way through the week...",
        "coverImageUrl": "https://minio.magic-pages.com/magic-pages/books/hungry-caterpillar-cover.jpg",
        "snapshotUrls": [
          "https://minio.magic-pages.com/magic-pages/books/hungry-caterpillar-page1.jpg",
          "https://minio.magic-pages.com/magic-pages/books/hungry-caterpillar-page2.jpg"
        ],
        "rating": 4.9,
        "isBestseller": true,
        "isFeatured": true,
        "isNewRelease": false,
        "variants": [
          {
            "id": "variant-uuid-1",
            "format": "Board Book",
            "price": 12.99,
            "discountedPrice": 10.99,
            "isbn": "978-0399226908",
            "stock": 150,
            "isAvailable": true
          },
          {
            "id": "variant-uuid-2",
            "format": "Hardcover",
            "price": 18.99,
            "discountedPrice": null,
            "isbn": "978-0399255564",
            "stock": 45,
            "isAvailable": true
          }
        ]
      },
      {
        "id": "987fcdeb-51a2-43d1-a456-426614174999",
        "title": "Goodnight Moon",
        "subtitle": null,
        "slug": "goodnight-moon",
        "authorName": "Margaret Wise Brown",
        "publisher": "HarperFestival",
        "publishedDate": "1947-09-03T00:00:00.000Z",
        "description": "In a great green room, tucked away in bed, is a little bunny.",
        "longDescription": null,
        "coverImageUrl": "https://minio.magic-pages.com/magic-pages/books/goodnight-moon.jpg",
        "snapshotUrls": [],
        "rating": 4.8,
        "isBestseller": true,
        "isFeatured": false,
        "isNewRelease": false,
        "variants": [
          {
            "id": "variant-uuid-3",
            "format": "Board Book",
            "price": 8.99,
            "discountedPrice": null,
            "isbn": "978-0060775858",
            "stock": 0,
            "isAvailable": false
          }
        ]
      }
    ],
    "meta": {
      "itemsPerPage": 10,
      "totalItems": 42,
      "currentPage": 1,
      "totalPages": 5
    }
  }
  ```

## 4. TypeScript Interfaces

```typescript
// types/age-group.ts
export interface AgeGroup {
  id: string;
  label: string;
  description?: string;
  heroImage?: string;
  sortOrder: number;
}

// types/book.ts
export interface Book {
  id: string;
  title: string;
  slug: string;
  authorName?: string;
  coverImageUrl?: string;
  rating: number;
  isBestseller: boolean;
  isNewRelease: boolean;
  // Add other relevant fields like price
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    itemsPerPage: number;
    totalItems: number;
    currentPage: number;
    totalPages: number;
  };
}
```

## 5. React Implementation Guide

### 5.1. State Management (React Query)

We recommend using **TanStack Query (React Query)** for data fetching to handle caching, loading, and error states efficiently.

**`hooks/useAgeGroups.ts`**
```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { AgeGroup } from '@/types/age-group';

export const useAgeGroups = () => {
  return useQuery({
    queryKey: ['age-groups'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: AgeGroup[] }>('/age-groups');
      return data.data;
    },
    staleTime: 1000 * 60 * 60, // Cache for 1 hour (rarely changes)
  });
};
```

**`hooks/useBooksByAge.ts`**
```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Book, PaginatedResponse } from '@/types/book';

interface UseBooksByAgeParams {
  ageGroupId: string;
  page?: number;
  limit?: number;
  sort?: string;
}

export const useBooksByAge = ({ ageGroupId, page = 1, limit = 12, sort }: UseBooksByAgeParams) => {
  return useQuery({
    queryKey: ['books', 'age-group', ageGroupId, { page, limit, sort }],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<Book>>(`/ages/${ageGroupId}/books`, {
        params: { page, limit, sort },
      });
      return data;
    },
    keepPreviousData: true, // Smooth pagination
  });
};
```

### 5.2. Component Architecture

**`components/age-groups/AgeGroupCard.tsx`**
- **Props:** `ageGroup: AgeGroup`
- **Render:**
    - Link to `/ages/${ageGroup.id}`.
    - Display `heroImage` (use Next.js `<Image>` for optimization).
    - Overlay `label`.

**`pages/ages/[id].tsx` (or `app/ages/[id]/page.tsx`)**
- **Logic:**
    - Get `id` from router params.
    - Fetch Age Group details (can reuse `useAgeGroups` and find by ID, or fetch specifically if an endpoint exists).
    - Fetch Books using `useBooksByAge({ ageGroupId: id })`.
- **Layout:**
    - **Header:** Show Age Group Label & Description.
    - **Content:**
        - If `isLoading`: Show `<BookGridSkeleton />`.
        - If `isError`: Show `<ErrorMessage retry={refetch} />`.
        - If `data.data.length === 0`: Show "No books found for this age group."
        - Else: Render `<BookGrid books={data.data} />`.
    - **Pagination:** Render `<Pagination meta={data.meta} onPageChange={...} />`.

### 5.3. Routing
- Define a route `/ages/:id` in your router configuration.
- Ensure the `id` corresponds to the `id` field in the `AgeGroup` entity (e.g., "0-2", "3-5").

## 6. UX/UI Considerations

- **Loading States:** Use skeleton loaders for the book grid to prevent layout shift.
- **Images:** Age group hero images might be large. Use lazy loading and proper sizing.
- **SEO:**
    - The Age Group Landing Page should have dynamic metadata.
    - Title: `{AgeGroup.label} Books | Store Name`
    - Description: `{AgeGroup.description}`
- **Empty States:** If an age group has no books, provide a helpful message and a button to "Browse All Books" or "Go Home".
