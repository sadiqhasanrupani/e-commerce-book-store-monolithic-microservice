# Authentication API Documentation

Base URL: `/auth`

## 1. Register User
**Endpoint:** `POST /auth/register`

**Description:** Registers a new user and sends an OTP to their email.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "strongpassword123",
  "firstName": "John",
  "lastName": "Doe",
  "role": "BUYER" // Optional, defaults to BUYER
}
```

**Response (201 Created):**
```json
{
  "message": "User registered successfully. Please check your email for verification code.",
  "userId": 1,
  "email": "user@example.com"
}
```

## 2. Verify Registration
**Endpoint:** `POST /auth/register/verify`

**Description:** Verifies the OTP sent to the user's email and activates the account. Returns access and refresh tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Response (201 Created):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": 1,
  "email": "user@example.com",
  "role": "BUYER"
}
```
*Note: Refresh token is set as an HttpOnly cookie.*

## 3. Login (Password)
**Endpoint:** `POST /auth/sign-in`

**Description:** Authenticates a user with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "strongpassword123"
}
```

**Response (201 Created):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": 1,
  "email": "user@example.com",
  "role": "BUYER"
}
```

## 4. Verify Token (Session Check)
**Endpoint:** `POST /auth/verify-token`

**Description:** Verifies if the current access token is valid. (Note: The implementation sets cookies, this endpoint might be used for session restoration or cookie setting).

**Request Body:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." // Optional if using cookies
}
```

**Response (201 Created):**
Sets `access_token` and `refresh_token` cookies.

## 5. Refresh Token
**Endpoint:** `POST /auth/refresh`

**Description:** Uses the refresh token (from cookie) to issue a new access token.

**Request Body:**
*None (uses Cookie)*

**Response (200 OK):**
```json
{
  "accessToken": "new_access_token..."
}
```
