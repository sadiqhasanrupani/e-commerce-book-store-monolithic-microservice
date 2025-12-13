# Frontend Cart API Integration Guide

This guide details the API endpoints and data structures for the Cart module, along with examples using React Query for seamless frontend integration.

## Authentication

All Cart API endpoints require a valid Bearer token in the `Authorization` header.

```http
Authorization: Bearer <your_jwt_token>
```

## Data Types

### Interfaces

```typescript
// Cart Item Response
export interface CartItem {
  id: string;
  bookFormatVariantId: number;
  title: string;
  unitPrice: number;
  qty: number;
  image: string;
  subtotal: number;
}

// Cart Response
export interface Cart {
  id: string;
  items: CartItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
}

// Create Cart Item DTO
export interface CreateCartItemDto {
  bookFormatVariantId: number;
  qty: number; // Minimum: 1
}

// Update Cart Item DTO
export interface UpdateCartItemDto {
  qty: number; // Minimum: 1
}

// Checkout Address
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

// Payment Providers
export enum PaymentProvider {
  STRIPE = 'stripe',
  PAYPAL = 'paypal',
  // Add other providers as needed
}

// Checkout DTO
export interface CheckoutDto {
  paymentMethod: PaymentProvider;
  shippingAddress: Address;
}
```

## API Reference

### 1. Get Current User Cart

Retrieves the current user's active cart.

- **Endpoint**: `GET /cart`
- **Response**: `Cart`

### 2. Add Item to Cart

Adds a book item to the cart. If the item already exists, the quantity is updated (if logic permits, otherwise handled as a separate update).

- **Endpoint**: `POST /cart/items`
- **Body**: `CreateCartItemDto`
- **Response**: `Cart` (Updated cart)
- **Errors**:
  - `409 Conflict`: Insufficient stock.

### 3. Update Cart Item Quantity

Updates the quantity of a specific item in the cart.

- **Endpoint**: `PUT /cart/items/:itemId`
- **Body**: `UpdateCartItemDto`
- **Response**: `Cart` (Updated cart)
- **Errors**:
  - `409 Conflict`: Insufficient stock.
  - `404 Not Found`: Item not found.

### 4. Remove Item from Cart

Removes a specific item from the cart.

- **Endpoint**: `DELETE /cart/items/:itemId`
- **Response**: `204 No Content`

### 5. Clear Cart

Removes all items from the cart.

- **Endpoint**: `POST /cart/clear`
- **Response**: `204 No Content`

### 6. Checkout

Initiates the checkout process.

- **Endpoint**: `POST /cart/checkout`
- **Headers**:
  - `Idempotency-Key`: (Optional but recommended) Unique key for idempotency.
- **Body**: `CheckoutDto`
- **Response**: `201 Created` (Checkout initiated)

## React Query Integration

We recommend using TanStack Query (React Query) for managing server state. Below are custom hooks for the Cart API.

### Setup

Ensure you have a configured `axios` instance with an interceptor to attach the Bearer token.

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.VITE_API_BASE_URL || 'http://localhost:3000',
});

// Add interceptor to attach token...
```

### Hooks

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cart, CreateCartItemDto, UpdateCartItemDto, CheckoutDto } from './types'; // Import your types

// Keys for query caching
export const cartKeys = {
  all: ['cart'] as const,
  details: () => [...cartKeys.all, 'detail'] as const,
};

// Hook to get cart
export const useCart = () => {
  return useQuery<Cart>({
    queryKey: cartKeys.details(),
    queryFn: async () => {
      const { data } = await api.get('/cart');
      return data;
    },
  });
};

// Hook to add item
export const useAddToCart = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dto: CreateCartItemDto) => {
      const { data } = await api.post('/cart/items', dto);
      return data;
    },
    onSuccess: (data) => {
      // Update cart cache with new data
      queryClient.setQueryData(cartKeys.details(), data);
    },
  });
};

// Hook to update item quantity
export const useUpdateCartItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, dto }: { itemId: string; dto: UpdateCartItemDto }) => {
      const { data } = await api.put(`/cart/items/${itemId}`, dto);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(cartKeys.details(), data);
    },
  });
};

// Hook to remove item
export const useRemoveCartItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      await api.delete(`/cart/items/${itemId}`);
    },
    onSuccess: () => {
      // Invalidate to refetch fresh data
      queryClient.invalidateQueries({ queryKey: cartKeys.details() });
    },
  });
};

// Hook to clear cart
export const useClearCart = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.post('/cart/clear');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cartKeys.details() });
    },
  });
};

// Hook for checkout
export const useCheckout = () => {
  return useMutation({
    mutationFn: async (dto: CheckoutDto) => {
      const { data } = await api.post('/cart/checkout', dto);
      return data;
    },
  });
};
```

## Error Handling

Handle errors gracefully in your UI. Common error codes to watch for:

- **`INSUFFICIENT_STOCK`**: The requested quantity exceeds available stock.
  - *Action*: Show a toast or inline error message informing the user of the available stock (often returned in the error response).
- **`401 Unauthorized`**: User is not logged in or token expired.
  - *Action*: Redirect to login.
