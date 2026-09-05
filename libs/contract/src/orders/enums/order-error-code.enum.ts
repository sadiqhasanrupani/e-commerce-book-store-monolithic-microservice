/**
 * Typed error codes returned by the customer-facing order endpoints.
 *
 * Mirrors `CartErrorCode`: the storefront branches on `error.response.data.code`
 * rather than on the human-readable message, so these strings are part of the
 * API contract — rename them only with a coordinated frontend change.
 */
export enum OrderErrorCode {
  /** Order does not exist, or is not owned by the authenticated user. */
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  /** Payment already succeeded — cancelling requires a refund, not a self-service cancel. */
  ORDER_ALREADY_PAID = 'ORDER_ALREADY_PAID',
  /** Order has moved past the point where the customer may cancel it (shipped/delivered/refunded). */
  ORDER_NOT_CANCELLABLE = 'ORDER_NOT_CANCELLABLE',
  /**
   * The order is the caller's, but payment has not completed — returned by the
   * digital download endpoint, which will not hand over paid material until the
   * order reaches PAID.
   */
  ORDER_NOT_PAID = 'ORDER_NOT_PAID',
  /**
   * Admin tried to advance fulfilment on an order whose payment has not
   * succeeded. Nothing ships before the money is in.
   */
  FULFILLMENT_NOT_PAID = 'FULFILLMENT_NOT_PAID',
  /**
   * The requested fulfilment status is not reachable from the order's current
   * one — a backward move (SHIPPED -> PROCESSING), a skip (NOT_STARTED ->
   * DELIVERED), anything at all on a CANCELLED order, or a SHIPPED transition
   * submitted without carrier + tracking number.
   */
  FULFILLMENT_INVALID_TRANSITION = 'FULFILLMENT_INVALID_TRANSITION',
  /**
   * Admin tried to advance fulfilment on an order with no physical line.
   * Digital-only orders are delivered by e-mail at settlement time and never
   * leave NOT_STARTED — this endpoint has nothing to ship or deliver for them.
   */
  FULFILLMENT_NO_PHYSICAL_ITEMS = 'FULFILLMENT_NO_PHYSICAL_ITEMS',
}
