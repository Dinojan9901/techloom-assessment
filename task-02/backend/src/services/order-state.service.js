import { InvalidTransitionError, NotFoundError } from '../lib/errors.js';
import { canTransition } from '../lib/order-status.js';
import { Order } from '../models/Order.js';

/**
 * Moves an order to a new status, atomically.
 *
 * The current status is part of the update's filter, so the read-check-write is
 * a single operation: two concurrent callers cannot both see RESERVED and both
 * proceed. The loser gets `null` and, via `assert`, a clear 409 instead of a
 * silently corrupted order. This is what makes duplicate payment submissions
 * detectable rather than merely unlikely.
 *
 * @param {object} options
 * @param {string} options.orderId
 * @param {string|string[]} options.from  status(es) the order must currently be in
 * @param {string} options.to             status to move to
 * @param {object} [options.set]          extra fields to write in the same update
 * @param {string} [options.reason]       recorded in the order's status history
 * @returns {Promise<import('../models/Order.js').Order|null>}
 */
export async function transitionOrder({
  orderId,
  from,
  to,
  set = {},
  reason = '',
  session = null,
  assert = true,
}) {
  const fromStatuses = Array.isArray(from) ? from : [from];

  // Callers pass a set of statuses they are willing to act on (every status
  // still holding stock, say). Narrow it to the ones the state machine actually
  // allows, so a legal current status is not blocked by an illegal sibling in
  // the same list.
  const legalFrom = fromStatuses.filter((status) => canTransition(status, to));
  if (legalFrom.length === 0) {
    throw new InvalidTransitionError(fromStatuses.join(' | '), to);
  }

  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: { $in: legalFrom } },
    {
      $set: { status: to, ...set },
      $push: { statusHistory: { status: to, reason, at: new Date() } },
    },
    { new: true, session },
  );

  if (order || !assert) return order;

  const current = await Order.findById(orderId).session(session ?? null);
  if (!current) throw new NotFoundError('Order');
  throw new InvalidTransitionError(current.status, to);
}
