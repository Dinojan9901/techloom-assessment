import { Router } from 'express';
import { z } from 'zod';

import { ValidationError } from '../lib/errors.js';
import { asyncHandler, parseBody } from '../lib/http.js';
import { idempotent } from '../lib/idempotency.js';
import { nextStatuses, ORDER_STATUS } from '../lib/order-status.js';
import {
  cancelOrder,
  checkout,
  getOrder,
  listOrders,
} from '../services/order.service.js';
import { listPayments, processPayment } from '../services/payment.service.js';
import { SIMULATABLE_OUTCOMES } from '../services/gateway.mock.js';

const router = Router();

const checkoutInput = z.object({
  cartId: z.string().min(1),
  customer: z
    .object({ name: z.string().max(120).optional(), email: z.string().max(160).optional() })
    .optional(),
});

const payInput = z.object({
  /** Force a gateway outcome for demos and tests; omit for weighted random. */
  simulate: z.enum(SIMULATABLE_OUTCOMES).optional(),
});

const cancelInput = z.object({ reason: z.string().max(240).optional() });

function sessionId(req) {
  const id = req.get('X-Session-Id') || req.query.sessionId || req.body?.sessionId;
  if (!id) {
    throw new ValidationError('A session id is required', [
      { field: 'X-Session-Id', message: 'Send an X-Session-Id header' },
    ]);
  }
  return String(id);
}

/**
 * POST /api/orders/checkout
 * Converts the cart into a RESERVED order, holding stock for 5 minutes.
 * Carries idempotency so a retried or double-clicked checkout yields one order.
 */
router.post(
  '/checkout',
  idempotent('order.checkout'),
  asyncHandler(async (req, res) => {
    const { cartId, customer } = parseBody(checkoutInput, req.body);
    const order = await checkout({ sessionId: sessionId(req), cartId, customer });

    res.status(201).json({
      order,
      reservationExpiresAt: order.reservedUntil,
      reservationSecondsRemaining: order.reservedUntil
        ? Math.max(0, Math.round((order.reservedUntil.getTime() - Date.now()) / 1000))
        : 0,
    });
  }),
);

/**
 * POST /api/orders/:id/pay
 * One attempt against the mock gateway. Declines answer 402 and timeouts 504,
 * each with the resulting order, because both are handled outcomes rather than
 * server errors.
 */
router.post(
  '/:id/pay',
  idempotent('order.pay'),
  asyncHandler(async (req, res) => {
    const { simulate } = parseBody(payInput, req.body ?? {});
    const result = await processPayment({
      orderId: req.params.id,
      requestedOutcome: simulate ?? 'auto',
    });

    res.status(result.httpStatus).json({
      outcome: result.outcome,
      message: result.message,
      order: result.order,
      payment: result.payment,
    });
  }),
);

router.post(
  '/:id/cancel',
  idempotent('order.cancel'),
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(cancelInput, req.body ?? {});
    const order = await cancelOrder({ orderId: req.params.id, reason });
    res.json({ order });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, limit, skip, all } = req.query;
    const result = await listOrders({
      // The POS back office can see every terminal's orders; a terminal sees its own.
      sessionId: all === 'true' ? undefined : sessionId(req),
      status: status ? String(status).split(',') : undefined,
      limit: Number(limit) || 50,
      skip: Number(skip) || 0,
    });
    res.json(result);
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    const payments = await listPayments(order._id);

    res.json({
      order,
      payments,
      allowedTransitions: nextStatuses(order.status),
      reservationSecondsRemaining: order.reservedUntil
        ? Math.max(0, Math.round((order.reservedUntil.getTime() - Date.now()) / 1000))
        : 0,
    });
  }),
);

/** The lifecycle itself, so the UI can render it without hardcoding a copy. */
router.get('/meta/statuses', (req, res) => {
  res.json({
    statuses: Object.values(ORDER_STATUS).map((status) => ({
      status,
      next: nextStatuses(status),
    })),
  });
});

export default router;
