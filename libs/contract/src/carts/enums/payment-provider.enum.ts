/**
 * Payment providers accepted for **new** payments.
 *
 * Razorpay-only by team decision (roadmap #6). PhonePe was dropped from the
 * storefront first and removed from the backend afterwards; `googlepay` and
 * `paytm` were enum members that never had a wired provider, so a checkout
 * naming them created an order (and held stock) before failing at provider
 * lookup. Narrowing this enum means `CheckoutDto` now rejects them with a 400
 * before any row is written.
 *
 * This enum gates *selection*. It is deliberately NOT the full set of values
 * that may appear in `transactions.provider` — see `TRANSACTION_PROVIDERS`.
 */
export enum PaymentProvider {
  RAZORPAY = 'razorpay',
}

/**
 * Every value the `transactions.provider` column may legally hold, including
 * providers we no longer accept. Historical PhonePe transactions (and their
 * PAID orders) must stay readable, so `phonepe` remains a valid *stored*
 * value even though nothing can create one anymore.
 *
 * Used for the TypeORM column definition only. Keep in sync with the Postgres
 * `transactions_provider_enum` type (see migration
 * `1765200000000-AlignTransactionProviderEnum`).
 */
export const TRANSACTION_PROVIDERS = ['phonepe', 'razorpay'] as const;

export type TransactionProvider = (typeof TRANSACTION_PROVIDERS)[number];
