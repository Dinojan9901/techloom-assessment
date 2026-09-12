export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = status < 500;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, { status: 404, code: 'NOT_FOUND' });
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { status: 422, code: 'VALIDATION_ERROR', details });
  }
}

export class InsufficientStockError extends AppError {
  constructor(details) {
    super('Insufficient stock available', {
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      details,
    });
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from, to) {
    super(`Cannot move an order from ${from} to ${to}`, {
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      details: { from, to },
    });
  }
}

/**
 * A second attempt at something that may only happen once (paying twice for the
 * same order, checking out the same cart twice).
 */
export class DuplicateRequestError extends AppError {
  constructor(message = 'This request has already been processed', details) {
    super(message, { status: 409, code: 'DUPLICATE_REQUEST', details });
  }
}

export class ReservationExpiredError extends AppError {
  constructor() {
    super('The stock reservation for this order has expired', {
      status: 410,
      code: 'RESERVATION_EXPIRED',
    });
  }
}

export class PaymentFailedError extends AppError {
  constructor(message, details) {
    super(message, { status: 402, code: 'PAYMENT_FAILED', details });
  }
}

export class PaymentTimeoutError extends AppError {
  constructor(details) {
    super('The payment gateway timed out', {
      status: 504,
      code: 'PAYMENT_TIMEOUT',
      details,
    });
  }
}
