/**
 * DI token for the active mail transport.
 *
 * `IEmailProvider` is an interface, and interfaces do not survive to runtime,
 * so Nest has nothing to key the injection on — hence an explicit token. This
 * mirrors the payment side, which is documented as
 * `@Inject('PAYMENT_PROVIDER') private paymentProvider: IPaymentProvider`
 * in `docs/payment-strategy-pattern.md`.
 *
 * It is exported as a `const` rather than written as a bare string literal at
 * each call site so that a typo is a compile error instead of a
 * "Nest can't resolve dependencies" crash at boot.
 *
 * Usage:
 * ```ts
 * constructor(
 *   @Inject(EMAIL_PROVIDER_TOKEN) private readonly provider: IEmailProvider,
 * ) {}
 * ```
 */
export const EMAIL_PROVIDER_TOKEN = 'EMAIL_PROVIDER';
