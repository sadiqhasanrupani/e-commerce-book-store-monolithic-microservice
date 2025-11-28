# Authentication API Documentation

## Base URL
```
http://localhost:8080/api/v1
```

## Endpoints

### 1. User Registration

**Endpoint**: `POST /auth/register`

**Description**: Register a new user and send email verification OTP.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "fullName": "John Michael Doe"
}
```

**Success Response** (201 Created):
```json
{
  "message": "User registered successfully. Please check your email for verification code.",
  "userId": 23,
  "email": "user@example.com"
}
```

**Error Responses**:
- `409 Conflict`: User already exists
- `400 Bad Request`: Invalid email or password format

**Notes**:
- Password must be at least 6 characters
- Email must be valid format
- OTP will be sent to the provided email
- Full name is split into firstName, lastName, and middleName automatically

**Example**:
```bash
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123",
    "fullName": "John Michael Doe"
  }'
```

---

### 2. Verify Email with OTP

**Endpoint**: `POST /auth/register/verify`

**Description**: Verify email address using the OTP sent during registration.

**Request Body**:
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Success Response** (200 OK):
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": 23,
  "email": "user@example.com",
  "role": "BUYER"
}
```

**Error Responses**:
- `400 Bad Request`: Invalid email or OTP format
- `401 Unauthorized`: Invalid OTP or expired
- `404 Not Found`: User not found

**Notes**:
- OTP must be exactly 6 characters
- OTP can be sent as string or number
- OTP expires after 15 minutes
- Returns JWT access token upon successful verification

**Example**:
```bash
curl -X POST http://localhost:8080/api/v1/auth/register/verify \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "otp": "123456"
  }'
```

---

### 3. User Login

**Endpoint**: `POST /auth/sign-in`

**Description**: Login with email and password.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Success Response** (200 OK):
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": 23,
  "email": "user@example.com",
  "role": "BUYER"
}
```

**Error Responses**:
- `401 Unauthorized`: Invalid credentials
- `400 Bad Request`: Invalid email format

**Example**:
```bash
curl -X POST http://localhost:8080/api/v1/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123"
  }'
```

---

### 4. Verify Token

**Endpoint**: `POST /auth/verify-token`

**Description**: Verify if a JWT token is valid.

**Request Body**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response** (200 OK):
```json
{
  "valid": true,
  "userId": 23,
  "email": "user@example.com",
  "role": "BUYER"
}
```

**Error Responses**:
- `401 Unauthorized`: Invalid or expired token

**Example**:
```bash
curl -X POST http://localhost:8080/api/v1/auth/verify-token \
  -H "Content-Type: application/json" \
  -d '{
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

---

## Authentication Flow

### Complete Registration & Login Flow

1. **Register User**
   ```bash
   POST /auth/register
   → Returns: { userId, email, message }
   → Email sent with OTP
   ```

2. **Verify Email**
   ```bash
   POST /auth/register/verify
   → Returns: { accessToken, userId, email, role }
   ```

3. **Use Access Token**
   ```bash
   # Include token in Authorization header for protected routes
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

### Subsequent Logins

```bash
POST /auth/sign-in
→ Returns: { accessToken, userId, email, role }
```

---

## Error Handling

All endpoints follow standard HTTP status codes:

- `200 OK`: Successful request
- `201 Created`: Resource created successfully
- `400 Bad Request`: Invalid request data
- `401 Unauthorized`: Authentication failed
- `404 Not Found`: Resource not found
- `409 Conflict`: Resource already exists
- `500 Internal Server Error`: Server error

**Error Response Format**:
```json
{
  "message": "Error description",
  "error": "Error type",
  "statusCode": 400
}
```

---

## Security Features

- ✅ Password hashing with bcrypt/argon2
- ✅ JWT token authentication
- ✅ Email verification with OTP
- ✅ Rate limiting (100 requests/minute per IP)
- ✅ CORS enabled
- ✅ Request validation with class-validator
- ✅ Retry logic for email sending (3 attempts with exponential backoff)
- ✅ Circuit breaker for email service
- ✅ 10-second timeout per email attempt

---

## Notes for Frontend Developers

1. **Store JWT Token**: Save the `accessToken` from login/verify responses in localStorage or secure cookie
2. **Include Token in Requests**: Add `Authorization: Bearer <token>` header to all protected API calls
3. **Handle Token Expiry**: Tokens expire after 1 hour (3600 seconds)
4. **OTP Format**: OTP can be sent as string `"123456"` or number `123456`
5. **Email Validation**: Use proper email validation on frontend before submission
6. **Error Messages**: Display error messages from API responses to users

---

## Testing

### Test Complete Registration Flow
```bash
# 1. Register
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","fullName":"Test User"}'

# 2. Check email for OTP (or check server logs in development)

# 3. Verify with OTP
curl -X POST http://localhost:8080/api/v1/auth/register/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","otp":"123456"}'

# 4. Use the returned accessToken for authenticated requests
curl -X GET http://localhost:8080/api/v1/users/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Swagger Documentation

Interactive API documentation available at:
```
http://localhost:8080/api/docs
```

(Swagger UI will be available once configured)
