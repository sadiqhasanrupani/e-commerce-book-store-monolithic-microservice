# Categories Flow Documentation

This document provides a comprehensive guide to the Categories flow for the e-commerce storefront. It details the API endpoints, data structures, and integration patterns for browsing and managing categories.

## 1. Overview

The Categories module allows users to browse books organized by topics, genres, or hierarchical classifications. It supports:
- **Category Details**: Fetching metadata for a specific category (e.g., "Fiction").
- **Books by Category**: Listing books within a category with support for filtering and pagination.
- **Category Management**: Admin APIs for creating, updating, and deleting categories (single and bulk operations).

## 2. Public API (Storefront)

### 2.1 Get Category Details

Fetches the metadata for a specific category using its slug. This is useful for rendering category pages, breadcrumbs, and SEO tags.

**Endpoint:** `GET /api/v1/categories/:slug`

**Parameters:**
- `slug` (Path, required): The URL-friendly identifier for the category (e.g., `science-fiction`).

**Response Example:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "name": "Science Fiction",
  "slug": "science-fiction",
  "age_group": null,
  "parent_id": "b2c3d4e5-f6a7-8901-2345-678901bcdef0",
  "children": [
    {
      "id": "c3d4e5f6-a7b8-9012-3456-789012cdef01",
      "name": "Cyberpunk",
      "slug": "cyberpunk",
      "age_group": null,
      "parent_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef"
    },
    {
      "id": "d4e5f6a7-b8c9-0123-4567-890123def012",
      "name": "Space Opera",
      "slug": "space-opera",
      "age_group": null,
      "parent_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef"
    }
  ]
}
```

### 2.2 Get Books by Category

Fetches a paginated list of books belonging to a specific category.

**Endpoint:** `GET /api/v1/categories/:slug/books`

**Parameters:**
- `slug` (Path, required): The category slug.
- `page` (Query, optional): Page number (default: 1).
- `limit` (Query, optional): Items per page (default: 20).
- `sort` (Query, optional): Sort field (e.g., `price`, `createdAt`).
- `order` (Query, optional): Sort order (`ASC` or `DESC`).

**Response Example:**

```json
{
  "message": "Books retrieved successfully",
  "data": [
    {
      "id": "e5f6a7b8-c9d0-1234-5678-901234ef0123",
      "title": "Dune",
      "subtitle": null,
      "slug": "dune",
      "authorName": "Frank Herbert",
      "publishedDate": "2023-10-01T10:00:00.000Z",
      "description": "Set on the desert planet Arrakis...",
      "coverImageUrl": "https://cdn.example.com/books/dune.jpg",
      "rating": 4.8,
      "isBestseller": true,
      "isFeatured": true,
      "isNewRelease": false,
      "variants": [
        {
          "id": 101,
          "format": "paperback",
          "price": {
            "amount": 12.99,
            "currency": "USD",
            "display": "$12.99"
          },
          "stockQuantity": 50,
          "isbn": "978-0441013593"
        }
      ]
    }
  ],
  "meta": {
    "itemsPerPage": 20,
    "totalItems": 1,
    "currentPage": 1,
    "totalPages": 1
  }
}
```

### 2.3 Get All Categories

Fetches a paginated list of top-level categories (or filtered by parent).

**Endpoint:** `GET /api/v1/categories`

**Parameters:**
- `page` (Query, optional): Page number (default: 1).
- `limit` (Query, optional): Items per page (default: 20).
- `parent_id` (Query, optional): Filter by parent ID. If omitted, returns only top-level categories.

**Response Example:**

```json
{
  "message": "Categories retrieved successfully",
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "name": "Fiction",
      "slug": "fiction",
      "age_group": null,
      "parent_id": null,
      "children": []
    }
  ],
  "meta": {
    "itemsPerPage": 20,
    "totalItems": 1,
    "currentPage": 1,
    "totalPages": 1
  }
}
```

## 3. Management API (Admin)

These endpoints are protected and require `ADMIN` role.

### 3.1 Create Category

**Endpoint:** `POST /api/v1/categories`

**Request Body:**

```json
{
  "name": "Fantasy",
  "slug": "fantasy",
  "age_group": "Teen",
  "parent_id": "optional-uuid-of-parent"
}
```

### 3.2 Bulk Operations

- **Bulk Create:** `POST /api/v1/categories/bulk`
- **Bulk Update:** `PUT /api/v1/categories/bulk`
- **Bulk Delete:** `DELETE /api/v1/categories/bulk`

**Bulk Create Example:**

```json
{
  "categories": [
    { "name": "High Fantasy", "slug": "high-fantasy", "parent_id": "parent-uuid" },
    { "name": "Dark Fantasy", "slug": "dark-fantasy", "parent_id": "parent-uuid" }
  ]
}
```

## 4. Data Types (Frontend Interfaces)

Use these interfaces to type your API responses in the frontend.

```typescript
// Category Entity
export interface Category {
  id: string;
  name: string;
  slug?: string;
  age_group?: string;
  parent_id?: string;
  children?: Category[];
}

// Book Response (Simplified for Category Listing)
export interface Book {
  id: string;
  title: string;
  subtitle?: string;
  slug: string;
  authorName?: string;
  publishedDate: string;
  description: string;
  coverImageUrl?: string;
  rating: number;
  isBestseller: boolean;
  isFeatured: boolean;
  isNewRelease: boolean;
  variants: BookVariant[];
}

export interface BookVariant {
  id: number;
  format: string;
  price: {
    amount: number;
    currency: string;
    display: string;
  };
  stockQuantity: number;
  isbn?: string;
}

export interface PaginatedResponse<T> {
  message: string;
  data: T[];
  meta: {
    itemsPerPage: number;
    totalItems: number;
    currentPage: number;
    totalPages: number;
  };
}
```
