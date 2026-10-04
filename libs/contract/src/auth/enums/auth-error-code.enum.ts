/**
 * Typed error codes returned by the authentication endpoints.
 *
 * Mirrors `OrderErrorCode` / `CartErrorCode`: the storefront branches on
 * `error.response.data.code` rather than on the human-readable message, so these
 * strings are part of the API contract — rename them only with a coordinated
 * frontend change.
 */
export enum AuthErrorCode {
  /**
   * Email/password pair did not match any account.
   *
   * Deliberately returned for BOTH "no such user" and "wrong password" so the
   * endpoint cannot be used to enumerate registered email addresses.
   * HTTP 401.
   */
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',

  /**
   * Credentials were correct, but the account has never completed email OTP
   * verification (`users.status = 'PENDING'` / `email_verified_at IS NULL`).
   *
   * The storefront should route the user to the "verify your email" screen and
   * offer to resend the code — NOT show a "wrong password" message.
   * HTTP 403. The response body carries `email` so the verify screen can be
   * pre-filled without asking the user to retype it.
   */
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',

  /**
   * Account exists and is verified, but has been suspended or soft-deleted.
   * The user cannot self-service their way out of this — support must act.
   * HTTP 403.
   */
  ACCOUNT_NOT_ACTIVE = 'ACCOUNT_NOT_ACTIVE',

  /**
   * Account exists but has no password hash (e.g. created through a social
   * login). The user must sign in with the original method or set a password.
   * HTTP 409.
   */
  PASSWORD_NOT_SET = 'PASSWORD_NOT_SET',

  /** OTP supplied for login/registration was wrong, expired, or already used. HTTP 401/400. */
  INVALID_OTP = 'INVALID_OTP',
}
