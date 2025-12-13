# Backend Specification: Unified Catalog & Faceted Search Service

**Priority:** Critical  
**Story Points:** 13 (Complex Query Construction + Performance)  
**Assignee:** Backend Engineering Team  
**Reporter:** Product & System Design Lead

---

## 1. Executive Summary
Currently, our "Browse" experience is fragmented. Users can view books by Age OR by Category, but they cannot easily combine filters (e.g., "Science books for 5-7 year olds under ₹500").

We need a **Unified Catalog Endpoint** ("Browse by Everything") that powers a comprehensive shop page. This endpoint must support multi-dimensional filtering, sorting, and pagination, serving as the backbone for the entire discovery experience.

---

## 2. User Story
**As a** Power Shopper,  
**I want to** view the entire book catalog and refine it using multiple filters simultaneously (Age + Category + Format + Price),  
**So that** I can find the perfect product that meets all my specific criteria.

---

## 3. Technical Specifications

### 3.1 API Contract

**Endpoint:** `GET /api/v1/books`

#### Request Parameters
The endpoint must accept a combination of query parameters. All filters are optional and additive (AND logic).

| Parameter | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `page` | `int` | Page number (1-based). Default: 1. | `1` |
| `limit` | `int` | Items per page. Default: 20. | `24` |
| `q` | `string` | Optional search term to narrow scope. | `space` |
| `age_groups` | `string[]` | Comma-separated list of age group IDs. | `3-5,5-7` |
| `categories` | `string[]` | Comma-separated list of category slugs. | `science,fiction` |
| `formats` | `string[]` | Comma-separated list of formats. | `PDF,PHYSICAL` |
| `price_min` | `int` | Minimum price in cents. | `0` |
| `price_max` | `int` | Maximum price in cents. | `5000` |
| `sort` | `string` | Sort key. Options: `relevance`, `newest`, `price_asc`, `price_desc`, `rating`. | `newest` |

#### Response Schema
The response must include **Facets** (aggregation counts) to let the frontend know how many books exist for other filters *within the current result set*.

```json
{
  "meta": {
    "total": 1250,
    "page": 1,
    "limit": 24,
    "totalPages": 53
  },
  "data": [
    {
      "id": 101,
      "title": "Space Explorers",
      "priceCents": 1200,
      "rating": 4.8,
      "coverUrl": "...",
      "ageGroups": ["5-7"],
      "category": "Science"
    }
    // ... more books
  ],
  "facets": {
    "ageGroups": [
      { "id": "3-5", "count": 450 },
      { "id": "5-7", "count": 320 }
    ],
    "categories": [
      { "id": "science", "name": "Science", "count": 120 },
      { "id": "fiction", "name": "Fiction", "count": 800 }
    ],
    "formats": [
      { "id": "PDF", "count": 1200 },
      { "id": "PHYSICAL", "count": 50 }
    ]
  }
}
```

---

## 4. Implementation Guidelines

### 4.1 Query Construction (The "Builder" Pattern)
Do not write a giant SQL string concatenation. Use a Query Builder or ORM features to dynamically append `WHERE` clauses.

*   **Base Query:** `SELECT * FROM books WHERE status = 'PUBLISHED'`
*   **If `age_groups`:** `JOIN book_age_groups bag ON bag.book_id = books.id WHERE bag.age_group_id IN (...)`
*   **If `price_max`:** `JOIN book_variants bv ON bv.book_id = books.id WHERE bv.price_cents <= ...`

### 4.2 Faceted Search (Advanced)
To return the `facets` counts efficiently:
*   **Option A (PostgreSQL):** Use separate `COUNT(*)` queries for each dimension, filtered by the *other* active filters. This can be heavy.
*   **Option B (ElasticSearch/OpenSearch):** If available, this is trivial using Aggregations.
*   **Option C (Caching):** If the dataset is small (< 10k items), cache the entire catalog in Redis and filter/aggregate in memory (Node.js/Go) for extreme speed. **Recommended for MVP.**

### 4.3 Sorting Logic
*   `price_asc` / `price_desc`: Must sort by the *lowest available variant price* for that book.
*   `relevance`: Only active if `q` is present. Otherwise, default to `newest` or `popularity`.

---

## 5. Acceptance Criteria (Definition of Done)

- [ ] **Multi-Filter Support**: Can filter by Age AND Category AND Format simultaneously.
- [ ] **Pagination**: `page=2` returns the correct next set of results.
- [ ] **Sorting**: Sorting by Price works correctly (considering multiple variants per book).
- [ ] **Facets Returned**: Response includes counts for sidebar filters.
- [ ] **Performance**: Response time < 300ms for complex filtered queries.
- [ ] **Edge Cases**:
    -   Filtering by a category that has 0 books returns empty list (not error).
    -   Invalid sort keys default to `newest`.

---

## 6. Developer Notes
> "The frontend `FilterPanel` component is already built to handle these inputs. Your job is to make the API listen to them. Currently, the frontend is mocking this or using simple client-side filtering which doesn't scale."

> "Pay attention to the 'Price' filter. Since a book has multiple variants (PDF @ $5, Hardcover @ $15), if I filter for 'Under $10', this book SHOULD appear because the PDF is under $10."
