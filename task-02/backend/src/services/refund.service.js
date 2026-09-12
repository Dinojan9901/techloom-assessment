import crypto from 'node:crypto';

import { DuplicateRequestError, NotFoundError, ValidationError } from '../lib/errors.js';
import { ORDER_STATUS } from '../lib/order-status.js';
import { withTransaction } from '../lib/transaction.js';
import { Order } from '../models/Order.js';
import { Payment, PAYMENT_OUTCOME } from '../models/Payment.js';
import { Refund, REFUND_REASON, REFUND_STATUS } from '../models/Refund.js';
import { restoreStock } from './inventory.service.js';
import { transitionOrder } from './order-state.service.js';

/**
 * Reverses a captured payment and puts the sold units back on the shelf.
 *
 * Only a PAID order has anything to reverse. Cancelling an order that never
 * captured (RESERVED, FAILED, EXPIRED) releases its hold instead and produces
 * no refund — there was no charge.
 */
export async function refundOrder({
  orderId,
  reason = REFUND_REASON.CUSTOMER_CANCELLED,
  note = '',
}) {
  return withTransaction(async (session) => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new NotFoundError('Order');

    if (order.status === ORDER_STATUS.REFUNDED) {
      throw new DuplicateRequestError('This order has already been refunded', {
        orderId,
        status: order.status,
      });
    }

    if (order.status !== ORDER_STATUS.PAID) {
      throw new ValidationError(
        `Only a paid order can be refunded; this one is ${order.status}`,
        [{ field: 'status', message: `Current status is ${order.status}` }],
      );
    }

    const payment = await Payment.findOne({
      order: order._id,
      outcome: PAYMENT_OUTCOME.SUCCESS,
    }).session(session);

    if (!payment) {
      throw new ValidationError('No captured payment found for this order');
    }

    const [refund] = await Refund.create(
      [
        {
          order: order._id,
          payment: payment._id,
          amountCents: payment.amountCents,
          status: REFUND_STATUS.SETTLED,
          reason,
          note,
          gatewayReference: `mock_rf_${crypto.randomBytes(8).toString('hex')}`,
        },
      ],
      { session },
    );

    // The customer is no longer buying these, so they go back on sale.
    await restoreStock(order.items, session);

    const refunded = await transitionOrder({
      orderId: order._id,
      from: ORDER_STATUS.PAID,
      to: ORDER_STATUS.REFUNDED,
      set: { reservedUntil: null, failureReason: note || 'Refunded to the original payment method' },
      reason: `Refund ${refund.gatewayReference}`,
      session,
    });

    return { order: refunded, refund };
  });
}

export async function listRefunds(orderId) {
  return Refund.find({ order: orderId }).sort({ createdAt: -1 });
}
