import { Router } from 'express';
import { z } from 'zod';

import { NotFoundError } from '../lib/errors.js';
import { asyncHandler, parseBody } from '../lib/http.js';
import { Product } from '../models/Product.js';

const router = Router();

const productInput = z.object({
  name: z.string().min(1).max(160),
  sku: z.string().min(1).max(64),
  description: z.string().max(2000).optional(),
  category: z.string().max(64).optional(),
  imageUrl: z.string().url().or(z.literal('')).optional(),
  priceCents: z.number().int().min(0),
  totalStock: z.number().int().min(0),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/products
 * Always reports live availability (total minus whatever is currently held),
 * so the storefront and the POS never show stock that someone else is buying.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search, category, inStock, includeInactive, limit = 100, skip = 0 } = req.query;

    const filter = {};
    if (includeInactive !== 'true') filter.isActive = true;
    if (category) filter.category = category;
    if (search) {
      const pattern = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: pattern }, { sku: pattern }, { description: pattern }];
    }
    if (inStock === 'true') {
      filter.$expr = { $gt: [{ $subtract: ['$totalStock', '$reservedStock'] }, 0] };
    }

    const [products, total, categories] = await Promise.all([
      Product.find(filter)
        .sort({ name: 1 })
        .skip(Number(skip) || 0)
        .limit(Math.min(Number(limit) || 100, 200)),
      Product.countDocuments(filter),
      Product.distinct('category', { isActive: true }),
    ]);

    res.json({ products, total, categories: categories.sort() });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) throw new NotFoundError('Product');
    res.json({ product });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(productInput, req.body);
    const product = await Product.create(input);
    res.status(201).json({ product });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(productInput.partial(), req.body);

    // `reservedStock` is owned by the reservation engine, never by an operator,
    // so restocking adjusts `totalStock` only and held units stay held.
    delete input.reservedStock;

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: input },
      { new: true, runValidators: true },
    );
    if (!product) throw new NotFoundError('Product');
    res.json({ product });
  }),
);

/**
 * DELETE /api/products/:id
 * Soft-deletes by default: a product with live reservations or past orders must
 * keep existing for history to make sense. `?hard=true` forces a real delete,
 * but only when nothing is currently held.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) throw new NotFoundError('Product');

    if (req.query.hard === 'true' && product.reservedStock === 0) {
      await product.deleteOne();
      return res.json({ deleted: true, hard: true, id: req.params.id });
    }

    product.isActive = false;
    await product.save();
    return res.json({ deleted: true, hard: false, product });
  }),
);

export default router;
