import crypto from 'node:crypto';

import {
  DuplicateRequestError,
  NotFoundError,
  ReservationExpiredError,
  ValidationError,
} from '../lib/errors.js';
import {
  HOLDS_RESERVED_STOCK,
  HOLDS_SOLD_STOCK,
  ORDER_STATUS,
  TERMINAL_STATUSES,
} from '../lib/order-status.js';
import { withTransaction } from '../lib/transaction.js';
import { Cart, CART_STATUS } from '../models/Cart.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { Reservation, RESERVATION_STATUS } from '../models/Reservation.js';
import { REFUND_REASON } from '../models/Refund.js';
import { transitionOrder } from './order-state.service.js';
import { refundOrder } from './refund.service.js';
import { createReservation, releaseReservation } from './reservation.service.js';

const orderNumber = () =>
  `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const populateOrder = (query) =>
  query.populate({ path: 'payment' }).populate({ path: 'items.product', select: 'name sku imageUrl' });

/**
 * Turns an open cart into a reserved order.
 *
 * Everything here happens in one transaction: claiming the cart, snapshotting
 * its lines, holding the stock and starting the 5-minute clock. If any single
 * line is short, nothing is held and the cart stays open.
 */
export async function checkout({ sessionId, cartId, customer = {} }) {
  return withTransaction(async (session) => {
    // Claiming the cart is itself a conditional update, so a double-clicked
    // "Checkout" button produces one order, not two.
    const cart = await Cart.findOneAndUpdate(
      { _id: cartId, sessionId, status: CART_STATUS.OPEN },
      { $set: { status: CART_STATUS.CHECKED_OUT } },
      { new: true, session },
    );

    if (!cart) {
      const existing = await Cart.findById(cartId).session(session);
      if (!existing) throw new NotFoundError('Cart');
      throw new DuplicateRequestError('This cart has already been checked out', {
        cartId,
        orderId: existing.checkedOutOrder ? String(existing.checkedOutOrder) : null,
      });
    }

    if (cart.items.length === 0) {
      throw new ValidationError('Cannot check out an empty cart');
    }

    const products = await Product.find({
      _id: { $in: cart.items.map((item) => item.product) },
    }).session(session);

    const byId = new Map(products.map((product) => [String(product._id), product]));

    const items = cart.items.map((item) => {
      const product = byId.get(String(item.product));
      if (!product || !product.isActive) {
        throw new NotFoundError(`Product ${item.product}`);
      }
      return {
        product: product._id,
        name: product.name,
        sku: product.sku,
        unitPriceCents: product.priceCents,
        quantity: item.quantity,
      };
    });

    const subtotalCents = items.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0,
    );

    const [order] = await Order.create(
      [
        {
          orderNumber: orderNumber(),
          cart: cart._id,
          sessionId,
          customer: {
            name: customer.name?.trim() || 'Walk-in customer',
            email: customer.email?.trim() || '',
          },
          items,
          subtotalCents,
          totalCents: subtotalCents,
          status: ORDER_STATUS.PENDING,
          statusHistory: [{ status: ORDER_STATUS.PENDING, reason: 'Order created from cart' }],
        },
      ],
      { session },
    );

    // Throws InsufficientStockError — and rolls the whole checkout back — if any
    // line cannot be held.
    const reservation = await createReservation({ order, session });

    const reserved = await transitionOrder({
      orderId: order._id,
      from: ORDER_STATUS.PENDING,
      to: ORDER_STATUS.RESERVED,
      set: { reservation: reservation._id, reservedUntil: reservation.expiresAt },
      reason: 'Stock reserved for checkout',
      session,
    });

    await Cart.updateOne(
      { _id: cart._id },
      { $set: { checkedOutOrder: order._id } },
      { session },
    );

    return reserved;
  });
}

export async function getOrder(orderId) {
  const order = await populateOrder(Order.findById(orderId));
  if (!order) throw new NotFoundError('Order');
  return order;
}

export async function listOrders({ sessionId, status, limit = 50, skip = 0 } = {}) {
  const filter = {};
  if (sessionId) filter.sessionId = sessionId;
  if (status) filter.status = Array.isArray(status) ? { $in: status } : status;

  const [orders, total] = await Promise.all([
    populateOrder(Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Math.min(limit, 200))),
    Order.countDocuments(filter),
  ]);

  return { orders, total, limit, skip };
}

/**
 * Cancels an order and puts its stock back where it belongs.
 *
 * What "cancel" means depends on whether money moved. An order that only ever
 * held stock is simply cancelled and its hold released. An order that captured
 * a payment has to be refunded, so this hands over to the refund flow and the
 * order lands in REFUNDED rather than CANCELLED.
 */
export async function cancelOrder({ orderId, reason = 'Cancelled by customer', note = '' }) {
  const current = await Order.findById(orderId);
  if (!current) throw new NotFoundError('Order');

  if (TERMINAL_STATUSES.includes(current.status)) {
    throw new DuplicateRequestError(
      `Order is already ${current.status.toLowerCase()} and cannot be cancelled`,
      { status: current.status },
    );
  }

  if (HOLDS_SOLD_STOCK.includes(current.status)) {
    const { order, refund } = await refundOrder({
      orderId,
      reason: REFUND_REASON.CUSTOMER_CANCELLED,
      note: note || reason,
    });
    return { order, refund };
  }

  const order = await withTransaction(async (session) => {
    const cancelled = await transitionOrder({
      orderId,
      from: HOLDS_RESERVED_STOCK,
      to: ORDER_STATUS.CANCELLED,
      set: { reservedUntil: null, failureReason: reason },
      reason,
      session,
    });

    if (cancelled.reservation) {
      await releaseReservation({ reservationId: cancelled.reservation, reason, session });
    }

    return cancelled;
  });

  return { order, refund: null };
}

/** Read-through expiry check, so a stale order is never shown as payable. */
export async function assertReservationLive(order) {
  if (!HOLDS_RESERVED_STOCK.includes(order.status)) return;
  if (order.reservedUntil && order.reservedUntil.getTime() <= Date.now()) {
    throw new ReservationExpiredError();
  }
  if (order.reservation) {
    const live = await Reservation.exists({
      _id: order.reservation,
      status: RESERVATION_STATUS.ACTIVE,
    });
    if (!live) throw new ReservationExpiredError();
  }
}
