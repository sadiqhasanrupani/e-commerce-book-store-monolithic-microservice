# Backend Specification: Age Group Taxonomy & Filtering Service

**Priority:** Medium-High  
**Story Points:** 5 (Schema Design + API Implementation)  
**Assignee:** Backend Engineering Team  
**Reporter:** Product & System Design Lead

---

## 1. Executive Summary
"Magic Pages" serves children at various developmental stages. The "Age Group" feature is a critical taxonomy layer that allows parents to filter content appropriate for their child's reading level and cognitive ability. 

Currently, the frontend hardcodes these values (`3-5`, `5-7`, etc.). We need to move this to the backend to allow for dynamic updates, richer metadata (descriptions, hero images for landing pages), and strict referential integrity in the database.

---

## 2. User Story
**As a** Content Manager,  
**I want to** define and manage age groups dynamically via API,  
**So that** I can adjust the ranges or add new developmental stages (e.g., "Toddler 1-3") without deploying new frontend code.

**As a** Parent,  
**I want to** click "Ages 3-5",  
**So that** I only see books that are safe and appropriate for my preschooler.

---

## 3. Technical Specifications

### 3.1 Database Schema (Proposed)
We need a dedicated table to treat Age Groups as first-class entities, not just string tags.

**Table:** `age_groups`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `varchar(10)` | PK | Human-readable ID, e.g., `3-5`, `9-12`. |
| `label` | `varchar(50)` | Not Null | Display text, e.g., "Ages 3-5". |
| `sort_order` | `integer` | Not Null | For controlling display order in UI. |
| `description` | `text` | | SEO-friendly description for the category page. |
| `hero_image_url` | `varchar(255)` | | URL for the banner image on the Age Group landing page. |

**Table:** `book_age_groups` (Many-to-Many)
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `book_id` | `bigint` | FK -> books.id |
| `age_group_id` | `varchar(10)` | FK -> age_groups.id |

### 3.2 API Contract

#### A. Get All Age Groups
Used to populate the filter sidebar and homepage "Shop by Age" section.

**Endpoint:** `GET /api/v1/age-groups`

**Response:**
```json
{
  "data": [
    {
      "id": "3-5",
      "label": "Ages 3-5",
      "description": "Picture books and early learning for preschoolers.",
      "heroImage": "https://cdn.magicpages.com/ages/3-5-hero.jpg",
      "sortOrder": 1
    },
    {
      "id": "5-7",
      "label": "Ages 5-7",
      "description": "Beginning readers and first chapter books.",
      "heroImage": "https://cdn.magicpages.com/ages/5-7-hero.jpg",
      "sortOrder": 2
    }
  ]
}
```

#### B. Get Books by Age Group
This can be handled by the main Search/List endpoint, but ensure it accepts the `ageGroup` filter.

**Endpoint:** `GET /api/v1/books?ageGroup=3-5`

---

## 4. Implementation Guidelines

### 4.1 Data Migration
*   If current books store age groups as a string array (e.g., `["3-5"]`) in a JSONB column or text array, create a migration script to:
    1.  Seed the `age_groups` table with the standard values: `3-5`, `5-7`, `7-9`, `9-12`.
    2.  Populate the `book_age_groups` join table by parsing existing book data.

### 4.2 Validation Logic
*   **Overlap Allowed:** A book can belong to multiple age groups (e.g., a book for 6-year-olds might fit both `5-7` and `7-9`).
*   **Referential Integrity:** When creating/updating a book, the `ageGroups` field must validate against the `age_groups` table. Reject invalid IDs.

### 4.3 Caching Strategy
*   Age Group definitions rarely change.
*   **Requirement:** Cache the `GET /age-groups` response heavily (e.g., 1 hour TTL or indefinite with manual invalidation).

---

## 5. Acceptance Criteria (Definition of Done)

- [ ] **Schema Created**: `age_groups` and join table exist in DB.
- [ ] **Seed Data**: Standard age ranges are populated in the DB.
- [ ] **API Live**: `GET /age-groups` returns the list sorted by `sort_order`.
- [ ] **Integration**: `GET /books` correctly filters using the new relationship.
- [ ] **Admin Support**: (Optional for this sprint) Internal endpoints to Create/Update age groups are ready.

---

## 6. Developer Notes
> "The frontend currently hardcodes these values in `SearchModal.tsx`. Once this API is ready, we will refactor the frontend to fetch these dynamically. This allows marketing to add a '0-2' or 'Teens' category later without an app deployment."

> "Please ensure the `id` is URL-safe (slug-like) because we will use it in the URL: `magicpages.com/shop/age/3-5`."
