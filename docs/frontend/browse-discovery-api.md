# Browse & Discovery API Documentation

This document outlines the backend APIs available for the Browse & Discovery features, including the Browse Hub, Browse by Age, Browse by Category, and Search.

## 1. Browse Hub

### Get Browse Metadata
Fetches aggregated metadata for the Browse Hub page, including age groups, categories, formats, and collections.

- **Endpoint:** `GET /browse/metadata`
- **Auth:** Public (No token required)

**Response Example:**
```json
{
  "ageGroups": [
    {
      "id": "3-5",
      "label": "Ages 3-5",
      "description": "Picture books and early learning.",
      "sortOrder": 2
    },
    {
      "id": "5-7",
      "label": "Ages 5-7",
      "description": "Early readers and first chapters.",
      "sortOrder": 3
    }
  ],
  "categories": [
    {
      "id": "uuid-1",
      "name": "Fiction",
      "slug": "fiction",
      "children": [
        { "id": "uuid-2", "name": "Adventure", "slug": "adventure" }
      ]
    }
  ],
  "formats": [
    {
      "id": "uuid-f1",
      "label": "PDF",
      "description": "Instant digital downloads",
      "benefit": "Read on any device",
      "icon": "file-text",
      "sortOrder": 1
    },
    {
      "id": "uuid-f2",
      "label": "Physical",
      "description": "Premium printed books",
      "benefit": "Doorstep delivery",
      "icon": "package",
      "sortOrder": 2
    }
  ],
  "collections": [
    {
      "id": "uuid-c1",
      "title": "Bestsellers",
      "description": "Most loved by families",
      "link": "/search?filter=bestseller",
      "icon": "trending-up",
      "colorTheme": "text-primary",
      "sortOrder": 1
    },
    {
      "id": "uuid-c2",
      "title": "New Releases",
      "description": "Fresh magical stories",
      "link": "/search?filter=new",
      "icon": "sparkles",
      "colorTheme": "text-accent-blue",
      "sortOrder": 2
    }
  ]
}
```

## 2. Browse by Age

### Get Books by Age Group
Fetches books filtered by a specific age group.

- **Endpoint:** `GET /ages/:ageGroup/books`
- **Auth:** Public
- **Path Params:**
  - `ageGroup`: The ID of the age group (e.g., `3-5`).

**Query Parameters:**
- `page` (number): Page number (default: 1).
- `limit` (number): Items per page (default: 10).
- `sortBy` (string): Sort field (e.g., `createdAt`, `title`).
- `sortOrder` (string): `ASC` or `DESC`.
- `formats` (string[]): Filter by format (e.g., `PDF`, `PHYSICAL`).
- `categories` (string[]): Filter by category slugs.
- `q` (string): Search query.

**Response Example:**
```json
{
  "message": "Books retrieved successfully",
  "meta": {
    "total": 100,
    "totalPages": 10,
    "page": 1,
    "limit": 10,
    "hasNextPage": true,
    "hasPreviousPage": false
  },
  "data": [
    {
      "id": "book-uuid-1",
      "title": "The Magic Forest",
      "authorName": "Jane Doe",
      "genre": "fantasy",
      "description": "A wonderful journey...",
      "isNewRelease": true,
      "slug": "the-magic-forest",
      "coverImageUrl": "https://example.com/cover.jpg",
      "isBestseller": false,
      "isFeatured": true,
      "variants": [
        {
          "id": 1,
          "format": "PDF",
          "price": {
            "amount": 9.99,
            "currency": "USD",
            "display": "$9.99"
          },
          "stockQuantity": 100
        }
      ]
    }
  ],
  "facets": {
    "ageGroups": [{ "id": "3-5", "count": 50 }],
    "categories": [{ "id": "cat-1", "name": "Fiction", "count": 30 }],
    "formats": [{ "id": "PDF", "count": 80 }]
  }
}
```

## 3. Browse by Category

### Get Category Details
Fetches details for a specific category.

- **Endpoint:** `GET /categories/:slug`
- **Auth:** Public
- **Path Params:**
  - `slug`: The slug of the category (e.g., `fiction`).

**Response Example:**
```json
{
  "id": "cat-uuid-1",
  "name": "Fiction",
  "slug": "fiction",
  "children": [
    {
      "id": "cat-uuid-2",
      "name": "Adventure",
      "slug": "adventure"
    }
  ]
}
```

### Get Books by Category
Fetches books filtered by a specific category.

- **Endpoint:** `GET /categories/:slug/books`
- **Auth:** Public
- **Path Params:**
  - `slug`: The slug of the category.

**Query Parameters:**
Same as "Get Books by Age Group".

**Response Example:**
Same structure as `GET /ages/:ageGroup/books`.

## 4. Search & Filtering

### Search Books
General search endpoint for books.

- **Endpoint:** `GET /books` (or `/books/search`)
- **Auth:** Public

**Query Parameters:**
- `q` (string): Search query.
- `ageGroups` (string[]): Filter by age groups.
- `categories` (string[]): Filter by categories.
- `isBestseller` (boolean): Filter by bestseller status.
- `isNewRelease` (boolean): Filter by new release status.
- `isFeatured` (boolean): Filter by featured status.
- `genre` (string): Filter by genre (enum).
- `formats` (string[]): Filter by formats.

**Response Example:**
Same structure as `GET /ages/:ageGroup/books`.
