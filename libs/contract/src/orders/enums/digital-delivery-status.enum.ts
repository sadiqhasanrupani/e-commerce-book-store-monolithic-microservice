/**
 * Delivery state of a single *digital* order item.
 *
 * Physical items never carry one of these — their column stays NULL, and the
 * API reports `deliveryStatus: null` for them. For a digital item, NULL means
 * "paid for but delivery not attempted yet" (or "not paid for yet"), which the
 * response DTO surfaces as `PENDING`.
 *
 * The state machine is deliberately tiny and only ever moves forward within a
 * single settlement:
 *
 *   NULL ──claim──> SENDING ──mail sent──────> DELIVERED
 *                      │
 *                      └──mail failed────────> FAILED
 *
 * The claim (NULL/FAILED -> SENDING) is a conditional UPDATE executed inside
 * the settlement transaction while the order row is write-locked. That is the
 * idempotency gate: whichever of the webhook / reconciliation cron /
 * `verifyOrder` gets there first claims the row, and every later attempt sees
 * a non-claimable status and sends nothing.
 */
export enum DigitalDeliveryStatus {
  /** Claimed by a settlement; the email is in flight. */
  SENDING = 'sending',

  /** The download email was accepted by the SMTP server. */
  DELIVERED = 'delivered',

  /**
   * The email could not be sent (after MailService's own retries and circuit
   * breaker). The buyer can still download from the order page — this status
   * exists so the failure is visible rather than silent.
   */
  FAILED = 'failed',
}
