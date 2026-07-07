export enum InvoiceStatus {
  DRAFT     = 'DRAFT',     // created, not yet sent to buyer
  ISSUED    = 'ISSUED',    // finalised and dispatched
  PAID      = 'PAID',      // payment confirmed
  OVERDUE   = 'OVERDUE',   // past due date, unpaid
  CANCELLED = 'CANCELLED',
  REFUNDED  = 'REFUNDED',
}
