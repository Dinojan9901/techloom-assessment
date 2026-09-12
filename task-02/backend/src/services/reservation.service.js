import { env } from '../config/env.js';
import { withTransaction } from '../lib/transaction.js';
import { ORDER_STATUS, HOLDS_RESERVED_STOCK } from '../lib/order-status.js';
import { Order } from '../models/Order.js';
import { Reservation, RESERVATION_STATUS } from '../models/Reservation.js';
import { commitStock, releaseStock, reserveStock } from './inventory.service.js';
import { transitionOrder } from './order-state.service.js';

/**
 * Holds stock for an order and starts the 5-minute clock.
 * Must be called inside the caller's session so the hold and the reservation
 * record commit together.
 */
export async function createReservation({ order, session, ttlMs = env.reservationTtlMs }) {
  const items = order.items.map(({ product, quantity }) => ({ product, quantity }));

  await reserveStock(items, session);

  const expiresAt = new Date(Date.now() + ttlMs);
  const [reservation] = await Reservation.create(
    [{ order: order._id, items, expiresAt, status: RESERVATION_STATUS.ACTIVE }],
    { session },
  );

  return reservation;
}

/**
 * Claims a reservation and gives its stock back.
 *
 * The claim is a conditional update from ACTIVE, so the sweeper, an explicit
 * cancellation and a failed payment can all race to release the same
 * reservation and the stock is still returned exactly once. Returns `false`
 * when someone else got there first.
 */
export async function releaseReservation({ reservationId, reason, session }) {
  const reservation = await Reservation.findOneAndUpdate(
    { _id: reservationId, status: RESERVATION_STATUS.ACTIVE },
    {
      $set: {
        status: RESERVATION_STATUS.RELEASED,
        settledAt: new Date(),
        releaseReason: reason,
      },
    },
    { new: true, session },
  );

  if (!reservation) return false;

  await releaseStock(reservation.items, session);
  return true;
}

/** Claims a reservation and converts the held units into sold units. */
export async function commitReservation({ reservationId, session }) {
  const reservation = await Reservation.findOneAndUpdate(
    { _id: reservationId, status: RESERVATION_STATUS.ACTIVE },
    { $set: { status: RESERVATION_STATUS.COMMITTED, settledAt: new Date() } },
    { new: true, session },
  );

  if (!reservation) return false;

  await commitStock(reservation.items, session);
  return true;
}

/**
 * Expires one reservation and its order together.
 * Safe to call on an already-settled reservation — it becomes a no-op.
 */
export async function expireReservation(reservationId) {
  return withTransaction(async (session) => {
    const released = await releaseReservation({
      reservationId,
      reason: 'Reservation window elapsed',
      session,
    });
    if (!released) return false;

    const reservation = await Reservation.findById(reservationId).session(session);

    await transitionOrder({
      orderId: reservation.order,
      from: HOLDS_RESERVED_STOCK,
      to: ORDER_STATUS.EXPIRED,
      set: { reservedUntil: null, failureReason: 'Checkout was not completed in time' },
      reason: 'Reservation expired',
      session,
      assert: false,
    });

    return true;
  });
}

/**
 * Releases every reservation whose window has closed.
 * Returns the number actually expired by this call.
 */
export async function sweepExpiredReservations({ now = new Date(), limit = 200 } = {}) {
  const due = await Reservation.find({
    status: RESERVATION_STATUS.ACTIVE,
    expiresAt: { $lte: now },
  })
    .select('_id')
    .limit(limit)
    .lean();

  let expired = 0;
  for (const { _id } of due) {
    try {
      if (await expireReservation(_id)) expired += 1;
    } catch (error) {
      console.error('[sweeper] failed to expire reservation', String(_id), error);
    }
  }
  return expired;
}

/**
 * Belt and braces: an order stuck holding stock past its window with no live
 * reservation (a crash between writes, say) still gets closed out.
 */
export async function sweepStaleOrders({ now = new Date() } = {}) {
  const stale = await Order.find({
    status: { $in: HOLDS_RESERVED_STOCK },
    reservedUntil: { $ne: null, $lte: now },
  })
    .select('_id reservation')
    .limit(200)
    .lean();

  let closed = 0;
  for (const order of stale) {
    if (order.reservation) {
      const live = await Reservation.exists({
        _id: order.reservation,
        status: RESERVATION_STATUS.ACTIVE,
      });
      if (live) continue; // the reservation sweep owns this one
    }

    const updated = await transitionOrder({
      orderId: order._id,
      from: HOLDS_RESERVED_STOCK,
      to: ORDER_STATUS.EXPIRED,
      set: { reservedUntil: null, failureReason: 'Checkout was not completed in time' },
      reason: 'Reservation expired',
      assert: false,
    });
    if (updated) closed += 1;
  }
  return closed;
}

let timer = null;

export function startReservationSweeper({ intervalMs = env.sweeperIntervalMs } = {}) {
  if (timer) return timer;

  const tick = async () => {
    try {
      const expired = await sweepExpiredReservations();
      const closed = await sweepStaleOrders();
      if (expired || closed) {
        console.log(`[sweeper] expired ${expired} reservation(s), closed ${closed} order(s)`);
      }
    } catch (error) {
      console.error('[sweeper] tick failed', error);
    }
  };

  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}

export function stopReservationSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}
