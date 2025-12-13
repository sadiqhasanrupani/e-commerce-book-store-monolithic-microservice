# Backend Specification: Intelligent Search & Discovery Service

**Priority:** High  
**Story Points:** 8 (Complex Logic + Performance Tuning)  
**Assignee:** Backend Engineering Team  
**Reporter:** Product & System Design Lead

---

## 1. Executive Summary
The "Magic Pages" bookstore requires a high-performance, fault-tolerant search service. Our users are parents and educators who may not know the exact title of a book. Therefore, the search must be **forgiving** (fuzzy matching), **context-aware** (filtering), and **instant** (optimized indexing).

The frontend expects a single RESTful endpoint that handles both the "Typeahead" (dropdown) and "Full Search" (results page) experiences.

---

## 2. User Story
**As a** Parent or Educator,  
**I want to** find books by typing partial titles, author names, or keywords,  
**So that** I can quickly locate relevant learning materials for my child without needing to know the exact book name.

---

## 3. Technical Specifications

### 3.1 API Contract

**Endpoint:** `GET /api/v1/books/search`

#### Request Parameters
| Parameter | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `q` | `string` | **Yes** | The raw search query. Minimum 2 characters. | `harry pot`, `math for 5yo` |
| `limit` | `int` | No | Maximum number of results to return. Default: `20`. | `5` (for modal), `50` (for page) |
| `offset` | `int` | No | Pagination offset. Default: `0`. | `0` |
| `ageGroup` | `string` | No | Filter by specific age group identifier. | `3-5`, `9-12` |
| `category` | `string` | No | Filter by category slug or name. | `activity-books` |
| `format` | `string` | No | Filter by available format. | `PDF`, `PHYSICAL` |

#### Response Schema
The response must be strictly typed to ensure frontend stability.

```json
{
  "meta": {
    "total": 145,
    "limit": 50,
    "offset": 0,
    "processingTimeMs": 45
  },
  "data": [
    {
      "id": 101,
      "title": "Magical Math Adventures",
      "slug": "magical-math-adventures",
      "authors": ["Sarah Smith"],
      "coverUrl": "https://cdn.magicpages.com/books/math-101.jpg",
      "ageGroups": ["5-7", "7-9"],
      "genres": ["Education", "Math"],
      "shortDescription": "Learn addition through magic spells...",
      "rating": 4.8,
      "formatVariants": [
        {
          "id": 501,
          "format": "PHYSICAL",
          "priceCents": 1299,
          "stockQuantity": 15
        },
        {
          "id": 502,
          "format": "PDF",
          "priceCents": 499,
          "stockQuantity": 9999
        }
      ]
    }
  ]
}
```

---

## 4. Implementation Guidelines & Logic

### 4.1 Search Logic (The "Brain")
The search algorithm should prioritize relevance in this order:
1.  **Exact Match**: Title or ISBN matches the query exactly.
2.  **Prefix Match**: Title starts with the query (e.g., "Har" -> "Harry Potter").
3.  **Author Match**: Query matches an author's name.
4.  **Description/Keyword Match**: Query appears in the description or tags.

**Requirement:** Implement **Fuzzy Matching** to handle typos.
*   *Input:* "Harry Poter" (one 't')
*   *Expected:* Should still return "Harry Potter".
*   *Tech Suggestion:* Use Levenshtein distance (max distance 2) or Trigram similarity (`pg_trgm` in PostgreSQL).

### 4.2 Filtering Logic
Filters are **AND** conditions.
*   If `q="math"` AND `ageGroup="3-5"`, ONLY return books that contain "math" AND are tagged for ages 3-5.
*   If a book has multiple formats (PDF, Physical), the Book object is returned if *at least one* variant matches the criteria (if applicable), but generally, search returns the Book entity.

### 4.3 Performance Requirements
*   **Latency:** The API must respond in **< 200ms** (p95) for the typeahead to feel "instant".
*   **Indexing:**
    *   Create a **GIN Index** on the `title` and `description` columns (if using Postgres).
    *   Index `authors` array.
    *   Composite index on `(age_group, category)` for fast filtering.

---

## 5. Acceptance Criteria (Definition of Done)

- [ ] **Endpoint Live**: `GET /books/search` is accessible and documented in Swagger/OpenAPI.
- [ ] **Search Works**: Searching for "Activity" returns books with "Activity" in the title.
- [ ] **Typos Handled**: Searching for "Actvity" (missing 'i') still returns "Activity Books".
- [ ] **Filters Work**: Passing `?q=math&ageGroup=3-5` returns only relevant books.
- [ ] **Performance**: Query execution plan shows index usage (no full table scans on large datasets).
- [ ] **Empty State**: Searching for "XyZ123" returns `{ data: [] }` with HTTP 200 (NOT 404).
- [ ] **Security**: Input is sanitized to prevent SQL Injection.

---

## 6. Developer Notes (Tips from the Senior Architect)
> "Don't over-engineer ElasticSearch yet. PostgreSQL's built-in Full Text Search (tsvector) is powerful enough for our catalog size (< 100k items). Focus on the `ts_rank` function to ensure the most relevant books appear at the top. If the user types 'Math', a book titled 'Math' should appear before 'Advanced Math'."

> "For the frontend integration, ensure the `formatVariants` array is populated. The frontend calculates the 'lowest price' from this array to display on the card."
