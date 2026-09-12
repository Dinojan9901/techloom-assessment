/**
 * Order lifecycle.
 *
 *   PENDING ──checkout──▶ RESERVED ──pay──▶ PROCESSING ──▶ PAID
 *      │                     │                  │            │
 *      │                     ├── cancel ──▶ CANCELLED ◀──────┤
 *      │                     ├── expire ──▶ EXPIRED          │
 *      └── cancel/expire ────┘                  │            └── refund ──▶ REFUNDED
 *                                          (stock released)
 *
 * PROCESSING exists so that a payment attempt can claim an order atomically:
 * the claim is a conditional update from RESERVED to PROCESSING, so a second
 * concurrent attempt finds nothing to claim and is rejected as a duplicate.
 */
export const ORDER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RESERVED: 'RESERVED',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
});

const TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.RESERVED, ORDER_STATUS.CANCELLED, ORDER_STATUS.EXPIRED],
  [ORDER_STATUS.RESERVED]: [
    ORDER_STATUS.PROCESSING,
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.EXPIRED,
  ],
  [ORDER_STATUS.PROCESSING]: [ORDER_STATUS.PAID, ORDER_STATUS.FAILED, ORDER_STATUS.EXPIRED],
  [ORDER_STATUS.PAID]: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.FAILED]: [],
  [ORDER_STATUS.EXPIRED]: [],
  [ORDER_STATUS.CANCELLED]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.REFUNDED]: [],
});

/** Statuses that still hold reserved (not yet sold) stock. */
export const HOLDS_RESERVED_STOCK = Object.freeze([
  ORDER_STATUS.PENDING,
  ORDER_STATUS.RESERVED,
  ORDER_STATUS.PROCESSING,
]);

/** Statuses where stock has been sold and would need restoring to undo. */
export const HOLDS_SOLD_STOCK = Object.freeze([ORDER_STATUS.PAID]);

/** Statuses that can never change again. */
export const TERMINAL_STATUSES = Object.freeze(
  Object.entries(TRANSITIONS)
    .filter(([, next]) => next.length === 0)
    .map(([status]) => status),
);

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function nextStatuses(from) {
  return [...(TRANSITIONS[from] ?? [])];
}
