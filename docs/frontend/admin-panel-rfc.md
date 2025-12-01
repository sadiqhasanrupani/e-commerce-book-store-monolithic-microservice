# Admin Panel RFC: Browse Hub Management

## 1. Introduction
This document outlines the technical specifications for the Admin Panel features related to the **Browse Hub**. The goal is to provide a user-friendly interface for administrators to manage dynamic content such as **Browse Formats** and **Browse Collections**.

The Admin Panel is built using **Next.js**. This RFC provides guidelines on integrating with the backend APIs, handling authentication, and managing state.

## 2. Authentication & Authorization
All Admin APIs are protected and require the following:
- **Header:** `Authorization: Bearer <access_token>`
- **Role:** The user must have the `ADMIN` role.

Ensure that the Next.js middleware or higher-order components verify the user's role before granting access to these pages.

## 3. Data Models

### Browse Format
Represents a book format (e.g., eBook, Audiobook, Hardcover).

```typescript
interface BrowseFormat {
  id: string;
  label: string;       // e.g., "PDF"
  description?: string; // e.g., "Instant digital downloads"
  benefit?: string;    // e.g., "Read on any device"
  icon?: string;       // e.g., "file-text" (Lucide icon name)
  sortOrder: number;   // Default: 0
  createdAt: string;
  updatedAt: string;
}
```

### Browse Collection
Represents a curated collection of books.

```typescript
interface BrowseCollection {
  id: string;
  title: string;       // e.g., "Bestsellers"
  description?: string;
  link: string;        // e.g., "/search?filter=bestseller"
  icon?: string;       // e.g., "trending-up"
  colorTheme?: string; // e.g., "text-primary"
  sortOrder: number;   // Default: 0
  createdAt: string;
  updatedAt: string;
}
```

## 4. API Reference

Base URL: `/api/v1/browse`

### 4.1 Formats Management

| Method | Endpoint | Description | Body |
| :--- | :--- | :--- | :--- |
| `POST` | `/formats` | Create a single format | `CreateBrowseFormatDto` |
| `PUT` | `/formats/:id` | Update a single format | `UpdateBrowseFormatDto` |
| `DELETE` | `/formats/:id` | Delete a single format | - |
| `POST` | `/formats/bulk` | Bulk create formats | `{ formats: CreateBrowseFormatDto[] }` |
| `PUT` | `/formats/bulk` | Bulk update formats | `{ formats: UpdateBrowseFormatWithIdDto[] }` |
| `DELETE` | `/formats/bulk` | Bulk delete formats | `{ ids: string[] }` |

### 4.2 Collections Management

| Method | Endpoint | Description | Body |
| :--- | :--- | :--- | :--- |
| `POST` | `/collections` | Create a single collection | `CreateBrowseCollectionDto` |
| `PUT` | `/collections/:id` | Update a single collection | `UpdateBrowseCollectionDto` |
| `DELETE` | `/collections/:id` | Delete a single collection | - |
| `POST` | `/collections/bulk` | Bulk create collections | `{ collections: CreateBrowseCollectionDto[] }` |
| `PUT` | `/collections/bulk` | Bulk update collections | `{ collections: UpdateBrowseCollectionWithIdDto[] }` |
| `DELETE` | `/collections/bulk` | Bulk delete collections | `{ ids: string[] }` |

### 4.3 Categories Management

| Method | Endpoint | Description | Body |
| :--- | :--- | :--- | :--- |
| `POST` | `/categories` | Create a single category | `CreateCategoryDto` |
| `PUT` | `/categories/:id` | Update a single category | `UpdateCategoryDto` |
| `DELETE` | `/categories/:id` | Delete a single category | - |

#### Example: Create Category
**Request:** `POST /api/v1/categories`
```json
{
  "name": "Science Fiction",
  "slug": "science-fiction",
  "age_group": "Teens",
  "parent_id": "uuid-of-parent-category"
}
```

**Response:**
```json
{
  "id": "uuid-new-category",
  "name": "Science Fiction",
  "slug": "science-fiction",
  "age_group": "Teens",
  "parent_id": "uuid-of-parent-category",
  "created_at": "2023-10-27T10:00:00Z",
  "updated_at": "2023-10-27T10:00:00Z"
}
```

## 5. Next.js Implementation Guidelines

### 5.1 Fetching Data
Use **Server Components** to fetch initial data for the admin dashboard tables. This ensures good performance and SEO (though less critical for admin panels).

```typescript
// app/admin/browse/page.tsx
async function BrowseAdminPage() {
  const metadata = await getBrowseMetadata(); // Fetch from /api/v1/browse/metadata
  return <BrowseDashboard initialData={metadata} />;
}
```

### 5.2 Client-Side State Management
For interactive features like drag-and-drop reordering or inline editing, use **React Query** (`@tanstack/react-query`) or **SWR**.

- **Optimistic Updates:** When reordering items (updating `sortOrder`), update the UI immediately before the API call completes to make the interface feel snappy.
- **Bulk Operations:** Use the bulk APIs for features like "Select All -> Delete" or "Save All Changes".

### 5.3 Forms & Validation
Use **React Hook Form** combined with **Zod** for frontend validation. Ensure the Zod schema matches the DTOs defined in the backend.

### 5.4 Icons
The `icon` field expects a string identifier. We recommend using **Lucide React** and dynamically rendering icons based on this string.

```tsx
import { icons } from 'lucide-react';

const DynamicIcon = ({ name }: { name: string }) => {
  const Icon = icons[name];
  return Icon ? <Icon /> : null;
};
```

## 6. Error Handling
- Handle `401 Unauthorized` by redirecting to login.
- Handle `403 Forbidden` by showing an "Access Denied" message.
- Handle `400 Bad Request` by displaying validation errors returned from the API.
