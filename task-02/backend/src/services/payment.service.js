import { DuplicateRequestError, NotFoundError, ReservationExpiredError } from '../lib/errors.js';
import { ORDER_STATUS } from '../lib/order-status.js';
import { withTransaction } from '../lib/transaction.js';
import { Order } from '../models/Order.js';
import { Payment, PAYMENT_OUTCOME } from '../models/Payment.js';
import { charge } from './gateway.mock.js';
import { transitionOrder } from './order-state.service.js';
import { assertReservationLive } from './order.service.js';
import { commitReservation, expireReservation, releaseReservation } from './reservation.service.js';

/**
 * Takes exclusive ownership of an order's payment attempt.
 *
 * RESERVED -> PROCESSING is a conditional update, so of two clicks on "Pay"
 * only one ever reaches the gateway. The other lands here with `null` and is
 * told precisely why: already in flight, already paid, or no longer payable.
 */
async function claimForPayment(orderId) {
  const claimed = await transitionOrder({
    orderId,
    from: ORDER_STATUS.RESERVED,
    to: ORDER_STATUS.PROCESSING,
    reason: 'Payment attempt started',
    assert: false,
  });

  if (claimed) return claimed;

  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError('Order');

  switch (order.status) {
    case ORDER_STATUS.PROCESSING:
      throw new DuplicateRequestError('A payment for this order is already in progress', {
        orderId,
        status: order.status,
      });
    case ORDER_STATUS.PAID:
      throw new DuplicateRequestError('This order has already been paid', {
        orderId,
        status: order.status,
        paymentId: order.payment ? String(order.payment) : null,
      });
    case ORDER_STATUS.EXPIRED:
      throw new ReservationExpiredError();
    default:
      throw new DuplicateRequestError(`An order in status ${order.status} cannot be paid`, {
        orderId,
        status: order.status,
      });
  }
}

/**
 * Runs one payment attempt end to end.
 *
 * Resolves for every *handled* outcome rather than throwing, because a decline
 * and a gateway timeout are ordinary business results the caller still needs
 * the resulting order for - not transport failures.
 *
 * @returns {Promise<{ outcome: string, httpStatus: number, order: object, payment: object, message: string }>}
 */
export async function processPayment({ orderId, requestedOutcome = 'auto' }) {
  const pending = await Order.findById(orderId);
  if (!pending) throw new NotFoundError('Order');

  // Refuse to charge against a hold that has already lapsed.
  await assertReservationLive(pending);

  const order = await claimForPayment(orderId);

  let result;
  try {
    result = await charge({ amountCents: order.totalCents, requestedOutcome });
  } catch (error) {
    // The gateway itself blew up. Treat it as a decline so no stock is stranded.
    await settleFailure({
      order,
      requestedOutcome,
      result: { message: 'Gateway error', reference: `mock_err_${Date.now().toString(36)}` },
    });
    throw error;
  }

  if (result.outcome === PAYMENT_OUTCOME.SUCCESS) {
    return settleSuccess({ order, result, requestedOutcome });
  }

  if (result.outcome === PAYMENT_OUTCOME.TIMEOUT) {
    return settleTimeout({ order, result, requestedOutcome });
  }

  return settleFailure({ order, result, requestedOutcome });
}

/** Success: held units become sold units and the order is confirmed. */
async function settleSuccess({ order, result, requestedOutcome }) {
  try {
    const settled = await withTransaction(async (session) => {
      const committed = await commitReservation({
        reservationId: order.reservation,
        session,
      });

      // The hold lapsed between the claim and the capture. Aborting here voids
      // the (simulated) charge rather than confirming an order we cannot fill.
      if (!committed) throw new ReservationExpiredError();

      const [payment] = await Payment.create(
        [
          {
            order: order._id,
            amountCents: order.totalCents,
            outcome: PAYMENT_OUTCOME.SUCCESS,
            gatewayReference: result.reference,
            requestedOutcome,
            message: result.message,
            latencyMs: result.latencyMs,
          },
        ],
        { session },
      );

      const paid = await transitionOrder({
        orderId: order._id,
        from: ORDER_STATUS.PROCESSING,
        to: ORDER_STATUS.PAID,
        set: { payment: payment._id, reservedUntil: null, failureReason: '' },
        reason: 'Payment captured',
        session,
      });

      return { order: paid, payment };
    });

    return {
      outcome: PAYMENT_OUTCOME.SUCCESS,
      httpStatus: 201,
      message: result.message,
      ...settled,
    };
  } catch (error) {
    if (error?.code === 11000) {
      // The unique index caught a second successful charge for this order.
      throw new DuplicateRequestError('This order has already been paid', {
        orderId: String(order._id),
      });
    }

    // Nothing was written, so the order is still PROCESSING. Close it out.
    await expireReservation(order.reservation).catch(() => {});
    await transitionOrder({
      orderId: order._id,
      from: ORDER_STATUS.PROCESSING,
      to: ORDER_STATUS.EXPIRED,
      set: { reservedUntil: null, failureReason: 'Reservation lapsed before the charge settled' },
      reason: 'Reservation expired during payment',
      assert: false,
    });
    throw error;
  }
}

/** Decline: the hold is released immediately so the stock goes back on sale. */
async function settleFailure({ order, result, requestedOutcome = 'auto' }) {
  const settled = await withTransaction(async (session) => {
    if (order.reservation) {
      await releaseReservation({
        reservationId: order.reservation,
        reason: 'Payment failed',
        session,
      });
    }

    const [payment] = await Payment.create(
      [
        {
          order: order._id,
          amountCents: order.totalCents,
          outcome: PAYMENT_OUTCOME.FAILURE,
          gatewayReference: result?.reference ?? `mock_err_${Date.now().toString(36)}`,
          requestedOutcome,
          message: result?.message ?? 'Payment failed',
          latencyMs: result?.latencyMs ?? 0,
        },
      ],
      { session },
    );

    const failed = await transitionOrder({
      orderId: order._id,
      from: ORDER_STATUS.PROCESSING,
      to: ORDER_STATUS.FAILED,
      set: {
        payment: payment._id,
        reservedUntil: null,
        failureReason: result?.message ?? 'Payment failed',
      },
      reason: 'Payment declined',
      session,
    });

    return { order: failed, payment };
  });

  return {
    outcome: PAYMENT_OUTCOME.FAILURE,
    httpStatus: 402,
    message: settled.payment.message,
    ...settled,
  };
}

/**
 * Timeout: the spec asks for the reservation to *expire*, so the hold is
 * released and the order lands in EXPIRED rather than FAILED - the customer can
 * start a fresh checkout and the stock is back on sale for everyone.
 */
async function settleTimeout({ order, result, requestedOutcome }) {
  const settled = await withTransaction(async (session) => {
    if (order.reservation) {
      await releaseReservation({
        reservationId: order.reservation,
        reason: 'Payment gateway timed out',
        session,
      });
    }

    const [payment] = await Payment.create(
      [
        {
          order: order._id,
          amountCents: order.totalCents,
          outcome: PAYMENT_OUTCOME.TIMEOUT,
          gatewayReference: result.reference,
          requestedOutcome,
          message: result.message,
          latencyMs: result.latencyMs,
        },
      ],
      { session },
    );

    const expired = await transitionOrder({
      orderId: order._id,
      from: ORDER_STATUS.PROCESSING,
      to: ORDER_STATUS.EXPIRED,
      set: { payment: payment._id, reservedUntil: null, failureReason: result.message },
      reason: 'Payment timed out; reservation expired',
      session,
    });

    return { order: expired, payment };
  });

  return {
    outcome: PAYMENT_OUTCOME.TIMEOUT,
    httpStatus: 504,
    message: settled.payment.message,
    ...settled,
  };
}

export async function listPayments(orderId) {
  return Payment.find({ order: orderId }).sort({ createdAt: -1 });
}
