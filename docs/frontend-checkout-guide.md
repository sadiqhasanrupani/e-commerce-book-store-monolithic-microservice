# Checkout & Payment Integration Guide

This document outlines the checkout process, API integration details, and payment flow for the e-commerce storefront.

## 1. Checkout Process Overview

The checkout process is designed to be atomic and secure, handling stock reservation, order creation, and payment initiation in a single flow.

### High-Level Flow
1.  **User initiates checkout** from the Cart page.
2.  **Frontend calls `POST /api/v1/cart/checkout`** with shipping details and selected payment method.
3.  **Backend performs validations**:
    *   Locks the cart and inventory.
    *   Validates stock availability (JIT check).
    *   Creates an `Order` with `PENDING` status.
4.  **Backend initiates payment** via the selected provider (e.g., PhonePe).
5.  **Backend returns `paymentUrl`** (and optionally `qrCode`) to the frontend.
6.  **Frontend handles payment**:
    *   **Mobile**: Redirects user to the payment app (UPI Intent) using `paymentUrl`.
    *   **Web**: Displays QR Code or redirects to the provider's standard checkout page (depending on provider config).
7.  **Payment Completion**:
    *   User completes payment.
    *   Provider sends a webhook to `POST /api/v1/cart/webhook/payment`.
    *   Backend updates Order status to `PAID`.
    *   Frontend polls for status or shows success page based on callback.

---

## 2. API Integration Details

### Endpoint
`POST /api/v1/cart/checkout`

### Request Headers
*   `Authorization`: Bearer <token>
*   `Idempotency-Key`: <unique-uuid> (Recommended to prevent duplicate orders)

### Request Body (`CheckoutDto`)
```json
{
  "paymentMethod": "phonepe", // or "googlepay"
  "shippingAddress": {
    "line1": "123 Main St",
    "line2": "Apt 4B",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001",
    "phone": "+919876543210"
  }
}
```

### Response (`PaymentInitiationResponse`)
```json
{
  "transactionId": "PHONEPE_ORD123_1701234567890",
  "paymentUrl": "upi://pay?pa=merchant@phonepe&...",
  "expiresAt": "2024-01-01T12:15:00Z",
  "provider": "phonepe"
}
```

---

## 3. PhonePe Integration (Frontend Guide)

The current backend implementation for PhonePe is configured for **UPI Intent** flow.

### Handling the Response

1.  **Mobile Web / App**:
    *   Use the `paymentUrl` (which starts with `upi://`) to deep link directly to the UPI app.
    *   Example: `window.location.href = response.paymentUrl;`

2.  **Desktop Web**:
    *   The current mock returns a UPI intent link which won't work directly on desktop.
    *   **Action Required**: For desktop, we typically display a QR code. The backend `PhonePeProvider` can be enhanced to return a QR code string or a web-redirect URL if "Standard Checkout" is preferred.
    *   *Note*: If you need a standard web redirect (Pay Page), please let the backend team know to switch the `paymentInstrument` type to `PAY_PAGE`.

### Payment Status
After initiating payment, the frontend should:
1.  **Poll for status** (Optional but recommended for better UX):
    *   Endpoint: `GET /api/v1/orders/:orderId` (Ensure this endpoint exposes payment status).
2.  **Handle Redirect**:
    *   PhonePe will callback to the `callbackUrl` provided in the initiation.
    *   The backend handles the webhook validation.

---

## 4. Adding a New Payment Method

The backend uses a **Strategy Pattern** for payment providers. To add a new method (e.g., Paytm):

1.  **Backend**:
    *   Create a new provider class implementing `IPaymentProvider`.
    *   Register it in `CartModule`.
    *   Update `CheckoutDto` enum.
2.  **Frontend**:
    *   Add the new option to the payment selection UI.
    *   Send the corresponding enum value in the `checkout` API call.
    *   Handle the response (Redirect vs QR vs Intent) as appropriate for the new provider.

## 5. Documentation Resources

*   **Backend Strategy Pattern**: [`docs/payment-strategy-pattern.md`](file:///mnt/data/work/freelance/sohail-ecommerce/project/backend/e-commerce-book-store-monolithic-microservice/docs/payment-strategy-pattern.md) - Detailed architecture and configuration guide.
