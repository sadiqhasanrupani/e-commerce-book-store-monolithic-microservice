# Master Backend API Specification: Magic Pages Bookstore

**Version:** 1.3 (With SCRUM & Story Points)  
**Status:** Ready for Sprint Planning  
**Target Audience:** Backend Engineering Team

---

## 1. Overview
This document outlines the complete API surface required to power the "Magic Pages" frontend. The application is a children's bookstore with a focus on discovery (Age/Category), rich product details, and a seamless cart/checkout experience.

**Base URL:** `/api/v1`  
**Authentication:** Bearer Token (JWT) in `Authorization` header.

---

## 2. Catalog Service (`/books`)

### SCRUM Details
*   **Epic:** Product Discovery
*   **Story Points:** **13** (Complex)
*   **Key Challenges:** Performance of faceted search, complex SQL generation, caching strategy.

### 2.1 Search & Browse (Unified)
**GET** `/books`
*   **Query Params:** `q`, `page`, `limit`, `age_groups`, `categories`, `formats`, `sort`, `filter`

**Response Example:**
```json
{
  "meta": {
    "total": 145,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  },
  "data": [
    {
      "id": 101,
      "title": "Magical Math Adventures",
      "slug": "magical-math-adventures",
      "authors": ["Sarah Smith"],
      "coverUrl": "https://cdn.magicpages.com/books/math-101.jpg",
      "ageGroups": ["5-7", "7-9"],
      "category": { "id": "stem", "name": "STEM" },
      "rating": 4.8,
      "isFeatured": true,
      "formatVariants": [
        { "id": 501, "format": "PHYSICAL", "priceCents": 1299, "stockQuantity": 15, "isDigital": false },
        { "id": 502, "format": "PDF", "priceCents": 499, "stockQuantity": 9999, "isDigital": true }
      ]
    }
  ],
  "facets": {
    "ageGroups": [ { "id": "3-5", "count": 45 }, { "id": "5-7", "count": 32 } ],
    "categories": [ { "id": "stem", "name": "STEM", "count": 12 }, { "id": "fiction", "name": "Fiction", "count": 80 } ],
    "formats": [ { "id": "PDF", "count": 140 }, { "id": "PHYSICAL", "count": 50 } ]
  }
}
```

### 2.2 Get Book Details
**GET** `/books/:id`

**Response Example:**
```json
{
  "id": 101,
  "title": "Magical Math Adventures",
  "slug": "magical-math-adventures",
  "authors": ["Sarah Smith"],
  "coverUrl": "https://cdn.magicpages.com/books/math-101.jpg",
  "images": [ "https://cdn.magicpages.com/books/math-101.jpg", "https://cdn.magicpages.com/books/math-101-back.jpg" ],
  "ageGroups": ["5-7", "7-9"],
  "genres": ["Education", "Math"],
  "shortDescription": "Learn addition through magic spells...",
  "longDescription": "<p>Full HTML description...</p>",
  "bullets": [ "Master addition", "Fun characters" ],
  "rating": 4.8,
  "reviewCount": 124,
  "publisher": "Magic Press",
  "publicationDate": "2023-05-15",
  "formatVariants": [
    { "id": 501, "format": "PHYSICAL", "priceCents": 1299, "stockQuantity": 15, "sku": "PHY-MATH-101", "isDigital": false },
    { "id": 502, "format": "PDF", "priceCents": 499, "stockQuantity": 9999, "sku": "PDF-MATH-101", "downloadUrl": "...", "isDigital": true }
  ]
}
```

### 2.3 Get Related Books
**GET** `/books/:id/related`

**Response Example:**
```json
[
  { "id": 105, "title": "Science Spells", "authors": ["John Doe"], "coverUrl": "...", "ageGroups": ["5-7"], "rating": 4.5, "formatVariants": [{ "id": 601, "format": "PHYSICAL", "priceCents": 1199 }] }
]
```

---

## 3. Taxonomy Service

### SCRUM Details
*   **Epic:** Metadata Management
*   **Story Points:** **3** (Simple)
*   **Tasks:** Database migration for Age Groups, Seeding initial data, Caching layer implementation.

### 3.1 Get All Categories
**GET** `/categories`

**Response Example:**
```json
{
  "data": [
    { "id": 1, "slug": "fiction", "name": "Fiction", "description": "Imaginary worlds...", "icon": "book-open", "color": "text-primary", "bookCount": 850 }
  ]
}
```

### 3.2 Get All Age Groups
**GET** `/age-groups`

**Response Example:**
```json
{
  "data": [
    { "id": "3-5", "label": "Ages 3-5", "title": "Little Explorers", "description": "Picture books...", "heroImage": "...", "sortOrder": 1 }
  ]
}
```

---

## 4. Cart Service (`/cart`)

### SCRUM Details
*   **Epic:** Checkout & Sales
*   **Story Points:** **8** (Medium-Complex)
*   **Key Challenges:** Concurrency (stock checks), Price validation (sync with catalog), Session management.

### 4.1 Get Cart
**GET** `/cart`

**Response Example:**
```json
{
  "id": "cart_88a9s8d7",
  "userId": 123,
  "items": [
    {
      "id": "item_1",
      "bookId": 101,
      "bookTitle": "Magical Math Adventures",
      "bookCoverUrl": "...",
      "variantId": 501,
      "format": "PHYSICAL",
      "priceCents": 1299,
      "quantity": 2,
      "subtotalCents": 2598,
      "isDigital": false
    }
  ],
  "summary": {
    "itemCount": 2,
    "subtotalCents": 2598,
    "shippingCents": 500,
    "taxCents": 0,
    "discountCents": 0,
    "totalCents": 3098
  },
  "updatedAt": "2023-11-28T10:30:00Z"
}
```

### 4.2 Add Item
**POST** `/cart/items`
*   **Body:** `{ "bookFormatVariantId": 501, "quantity": 1 }`

**Response Example:** (Returns updated Cart object)

### 4.3 Update Item Quantity
**PUT** `/cart/items/:itemId`
*   **Body:** `{ "quantity": 3 }`

**Response Example:** (Returns updated Cart object)

### 4.4 Remove Item
**DELETE** `/cart/items/:itemId`

**Response Example:** (Returns updated Cart object)

---

## 5. Wishlist Service (`/wishlist`)

### SCRUM Details
*   **Epic:** User Engagement
*   **Story Points:** **3** (Simple)
*   **Tasks:** Wishlist table creation, API endpoints, Integration with Product Card.

### 5.1 Get Wishlist
**GET** `/wishlist`

**Response Example:**
```json
{
  "data": [
    { "id": 101, "title": "Magical Math Adventures", "authors": ["Sarah Smith"], "coverUrl": "...", "addedAt": "2023-11-20T14:00:00Z", "lowestPriceCents": 499 }
  ]
}
```

### 5.2 Add to Wishlist
**POST** `/wishlist/:bookId`

**Response Example:**
```json
{ "success": true, "message": "Book added to wishlist", "wishlistCount": 5 }
```

### 5.3 Remove from Wishlist
**DELETE** `/wishlist/:bookId`

**Response Example:**
```json
{ "success": true, "message": "Book removed from wishlist", "wishlistCount": 4 }
```

---

## 6. User Profile (`/users`)

### SCRUM Details
*   **Epic:** User Management
*   **Story Points:** **5** (Medium)
*   **Tasks:** Profile CRUD, Address Book management (multiple addresses), Preference storage.

### 6.1 Get Profile
**GET** `/users/me`

**Response Example:**
```json
{
  "id": 123,
  "email": "jane.doe@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "role": "BUYER",
  "createdAt": "2023-01-15T00:00:00Z",
  "preferences": { "marketingEmails": true, "childAgeGroups": ["3-5", "5-7"] },
  "addresses": [
    { "id": 1, "type": "shipping", "street": "123 Magic Lane", "city": "Storyville", "zip": "12345", "isDefault": true }
  ]
}
```

### 6.2 Update Profile
**PATCH** `/users/me`
*   **Body:** `{ "firstName": "Janet", "preferences": { "marketingEmails": false } }`

**Response Example:** (Returns updated User object)

---

## 7. Non-Functional Requirements
1.  **Performance:** Catalog endpoints (`/books`) must respond in < 200ms.
2.  **Caching:** Categories and Age Groups should be cached aggressively (CDN or Redis).
3.  **Security:** All `/cart`, `/wishlist`, and `/users` endpoints require valid Authentication.
4.  **Error Handling:** Return standard error objects: `{ "error": { "code": "OUT_OF_STOCK", "message": "..." } }`.
