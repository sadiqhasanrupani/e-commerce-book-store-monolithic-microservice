# Browse & Discovery API Documentation

This document outlines the backend APIs available for the Browse & Discovery features, including the Browse Hub, Browse by Age, Browse by Category, and Search.

## 1. Browse Hub

### Get Browse Metadata
Fetches aggregated metadata for the Browse Hub page, including age groups, categories, formats, and collections.

- **Endpoint:** `GET /browse/metadata`
- **Auth:** Public (No token required)

**Response:**
```json
{
  "ageGroups": [
    { "id": "3-5", "label": "Ages 3-5", ... }
  ],
  "categories": [
    { "id": "fiction", "name": "Fiction", "slug": "fiction", ... }
  ],
  "formats": [
    { "id": "PDF", "label": "PDF", ... }
  ],
  "collections": [
    { "id": "bestsellers", "title": "Bestsellers", "link": "/search?filter=bestseller", ... }
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

**Response:**
Standard Paginated Book Response.

## 3. Browse by Category

### Get Category Details
Fetches details for a specific category.

- **Endpoint:** `GET /categories/:slug`
- **Auth:** Public
- **Path Params:**
  - `slug`: The slug of the category (e.g., `fiction`).

**Response:**
```json
{
  "id": "...",
  "name": "Fiction",
  "slug": "fiction",
  "children": [...]
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

**Response:**
Standard Paginated Book Response.
