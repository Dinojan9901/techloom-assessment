import { Router } from 'express';
import { z } from 'zod';

import { ValidationError } from '../lib/errors.js';
import { asyncHandler, parseBody } from '../lib/http.js';
import {
  addItem,
  clearCart,
  getOrCreateCart,
  removeItem,
  setItemQuantity,
  summariseCart,
} from '../services/cart.service.js';

const router = Router();

/** POS terminals identify themselves with an opaque id they generate once. */
function sessionId(req) {
  const id = req.get('X-Session-Id') || req.query.sessionId || req.body?.sessionId;
  if (!id) {
    throw new ValidationError('A session id is required', [
      { field: 'X-Session-Id', message: 'Send an X-Session-Id header' },
    ]);
  }
  return String(id);
}

const addItemInput = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(999).default(1),
});

const quantityInput = z.object({
  quantity: z.number().int().min(0).max(999),
});

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const cart = await getOrCreateCart(sessionId(req));
    res.json({ cart: summariseCart(cart) });
  }),
);

router.post(
  '/current/items',
  asyncHandler(async (req, res) => {
    const session = sessionId(req);
    const { productId, quantity } = parseBody(addItemInput, req.body);

    await getOrCreateCart(session);
    const cart = await addItem({ sessionId: session, productId, quantity });

    res.status(201).json({ cart: summariseCart(cart) });
  }),
);

router.patch(
  '/current/items/:productId',
  asyncHandler(async (req, res) => {
    const { quantity } = parseBody(quantityInput, req.body);
    const cart = await setItemQuantity({
      sessionId: sessionId(req),
      productId: req.params.productId,
      quantity,
    });
    res.json({ cart: summariseCart(cart) });
  }),
);

router.delete(
  '/current/items/:productId',
  asyncHandler(async (req, res) => {
    const cart = await removeItem({
      sessionId: sessionId(req),
      productId: req.params.productId,
    });
    res.json({ cart: summariseCart(cart) });
  }),
);

router.delete(
  '/current',
  asyncHandler(async (req, res) => {
    const cart = await clearCart(sessionId(req));
    res.json({ cart: summariseCart(cart) });
  }),
);

export default router;
