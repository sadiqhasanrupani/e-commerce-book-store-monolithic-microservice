# Storefront Implementation Guide: Browse & Discovery

## 1. Introduction
This guide details the implementation of the **Browse & Discovery** features for the e-commerce storefront. It covers the **Browse Hub**, **Browse by Age**, **Browse by Category**, and **Search** functionalities.

The storefront is built using **React + Vite**. This guide emphasizes using **React Query** (`@tanstack/react-query`) for data fetching and **React Router** for state management.

## 2. Browse Hub (`/browse`)

The Browse Hub is the central discovery page. It aggregates various ways to explore books.

### 2.1 Data Fetching
Fetch metadata from the backend to render the page dynamically.

- **Endpoint:** `GET /api/v1/browse/metadata`
- **Strategy:** Use a custom hook with React Query to fetch this data on component mount.

```typescript
// src/features/browse/hooks/useBrowseMetadata.ts
import { useQuery } from '@tanstack/react-query';
import { browseApi } from '@/api/browse';

export const useBrowseMetadata = () => {
  return useQuery({
    queryKey: ['browse-metadata'],
    queryFn: browseApi.getMetadata,
  });
};

// src/pages/BrowsePage.tsx
export const BrowsePage = () => {
  const { data: metadata, isLoading } = useBrowseMetadata();

  if (isLoading) return <BrowseSkeleton />;
  if (!metadata) return <ErrorMessage />;
  
  return (
    <div className="browse-container">
      <HeroSection />
      <AgeGroupsSection data={metadata.ageGroups} />
      <BrowseFormatsSection data={metadata.formats} />
      <BrowseCollectionsSection data={metadata.collections} />
      <CategoriesSection data={metadata.categories} />
    </div>
  );
};
```

### 2.2 Components
- **AgeGroupsSection:** Renders cards for each age group (e.g., "0-2 Years", "3-5 Years"). Links to `/ages/:ageGroup`.
- **BrowseFormatsSection:** Renders icons/cards for formats (e.g., "PDF", "Audiobook"). Links to `/search?formats=[formatId]`.
- **BrowseCollectionsSection:** Renders curated lists (e.g., "Bestsellers"). Links to the `link` property provided in the API response.
- **CategoriesSection:** Renders a category tree or grid. Links to `/categories/:slug`.

## 3. Browse by Age (`/ages/:ageGroup`)

Displays books filtered by a specific age group.

### 3.1 Data Fetching
- **Endpoint:** `GET /api/v1/ages/:ageGroup/books`
- **Parameters:**
    - `page`: Pagination (default: 1)
    - `limit`: Items per page (default: 20)
    - `formats`: Array of format IDs (optional filter)
    - `categories`: Array of category slugs (optional filter)

### 3.2 UI Guidelines
- **Header:** Display the Age Group name and description.
- **Filters:** Sidebar or drawer with filters for **Formats** and **Categories**.
- **Sort:** Dropdown for sorting (e.g., "Newest", "Price: Low to High").

## 4. Browse by Category (`/categories/:slug`)

Displays books within a specific category.

### 4.1 Data Fetching
- **Endpoint:** `GET /api/v1/categories/:slug/books`
- **Parameters:** Same as Browse by Age.

### 4.2 UI Guidelines
- **Breadcrumbs:** Show the category hierarchy (e.g., "Home > Fiction > Fantasy").
- **Subcategories:** If the category has children, display them as quick links at the top.

## 5. Search & Filtering (`/search`)

The global search page.

### 5.1 Data Fetching
- **Endpoint:** `GET /api/v1/books`
- **Parameters:**
    - `search`: The search query string.
    - `formats`, `categories`, `ageGroups`: Filters.
    - `isBestseller`, `isNewRelease`: Boolean filters.

### 5.2 State Management (URL Params)
**Crucial:** Store all filter states in the URL query parameters. This ensures the page is shareable and refreshable. Use `useSearchParams` from `react-router-dom`.

```typescript
// Example hook usage
import { useSearchParams } from 'react-router-dom';

const SearchFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentFormats = searchParams.getAll('formats');

  const toggleFormat = (formatId: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (currentFormats.includes(formatId)) {
      newParams.delete('formats'); // Remove all to re-add filtered list if needed, or handle multi-value logic
      const newFormats = currentFormats.filter(f => f !== formatId);
      if (!currentFormats.includes(formatId)) newFormats.push(formatId);
      
      newFormats.forEach(f => newParams.append('formats', f));
    } else {
      newParams.append('formats', formatId);
    }
    setSearchParams(newParams);
  };
  
  // ... render UI
};
```

## 6. General Guidelines

### 6.1 Loading States
- Use **Skeleton Loaders** for book grids while fetching data (`isLoading` from React Query).
- Avoid blocking the entire UI; show loading indicators only for the parts being updated.

### 6.2 Error Handling
- Display a friendly "No books found" message if the API returns an empty list.
- Handle API errors (500, 404) with a generic error boundary or toast notification.

### 6.3 SEO
- Use `react-helmet-async` to manage `<title>` and `<meta>` tags dynamically for each page.
- Ensure semantic HTML (`<article>` for book cards, `<nav>` for filters).

