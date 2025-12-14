# Admin Panel Backend Update Report

**Date**: 2025-12-14
**To**: Principal Frontend Architect
**From**: Principal Backend Engineer
**Subject**: Fixes for Book Management & New Admin Auth

## 1. 🐛 Bug Fix: Book Update (500 Error)

The reported issue during the `PUT /api/v1/admin/books/:id` operation has been resolved.

- **Issue**: Backend returned 500 `Property "bookId" was not found in "BookFormatVariant"`.
- **Diagnosis**: The `BooksService` was attempting to find existing variants using a simplified `where` clause `{ bookId: id }`. However, in TypeORM with the current entity definition, `book` is a relation, and there is no explicit `bookId` column mapped in the entity properties for `find` queries.
- **Fix Applied**: Updated the query logic to use the strict relation syntax:
  ```typescript
  // Before
  where: { bookId: savedBook.id }

  // After
  where: { book: { id: savedBook.id } }
  ```
- **Action Required**: No changes needed on the frontend. Retry the `PUT` operation; it should now succeed.

---

## 2. 🔐 Feature: Admin Login Controller

To support the Admin Panel authentication requirement, I have implemented a dedicated Admin Login controller.

### Endpoint Details

- **URL**: `POST /api/v1/admin/auth/login`
- **Method**: `POST`
- **Access**: Public (no token required)

### Request Payload (`SignInDto`)
```json
{
  "email": "admin@example.com",
  "password": "your_secure_password"
}
```

### Response Success (`201 Created`)
Returns the standard Auth result with JWT.
```json
{
  "accessToken": "eyJhbGciOiJIUz...",
  "userId": 1,
  "email": "admin@example.com",
  "role": "ADMIN"
}
```

### Error Responses
- **401 Unauthorized**: Invalid credentials (email/password wrong).
- **403 Forbidden**: Valid credentials, but the user does **not** have the `ADMIN` role. This ensures only authorized personnel can access the panel.

### Frontend Integration Guide

1. **Login Page**: Point your Admin Login form to `POST /api/v1/admin/auth/login`.
2. **Error Handling**: 
   - Handle `403` specifically to show "Access Denied: You are not an administrator".
3. **Redirection**: On success, store the `accessToken` and redirect to `/admin/dashboard` (or equivalent).

This implementation ensures strict separation of concerns and security for the admin interface.
