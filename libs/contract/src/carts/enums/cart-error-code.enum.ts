export enum CartErrorCode {
  CART_NOT_FOUND = 'CART_NOT_FOUND',
  CART_EMPTY = 'CART_EMPTY',
  CART_ITEM_NOT_FOUND = 'CART_ITEM_NOT_FOUND',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_TIMEOUT = 'PAYMENT_TIMEOUT',
  TRANSACTION_ROLLBACK = 'TRANSACTION_ROLLBACK',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  INVALID_CART_STATUS = 'INVALID_CART_STATUS',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  /**
   * Checkout was attempted on a basket containing a physical (shippable) line
   * with no `shippingAddress` supplied. `CheckoutDto.shippingAddress` is
   * optional at the DTO layer (a digital-only order needs none), so this rule
   * is enforced here instead, against the same locked variant rows the stock
   * and shipping-cost decisions are made from.
   */
  SHIPPING_ADDRESS_REQUIRED = 'SHIPPING_ADDRESS_REQUIRED',
}
