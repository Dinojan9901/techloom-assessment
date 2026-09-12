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

const SORTS = {
  relevance: { name: 1 },
  'price-asc': { priceCents: 1 },
  'price-desc': { priceCents: -1 },
  newest: { createdAt: -1 },
  name: { name: 1 },
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/products
 *
 * The storefront's discovery endpoint: free-text search across name, SKU and
 * description, plus category, price-range and availability filters that
 * compose. Availability is computed from live reserved stock, so a product
 * someone else is checking out with drops out of an "in stock only" search.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const {
      search,
      category,
      minPrice,
      maxPrice,
      inStock,
      sort = 'relevance',
      includeInactive,
      limit = 60,
      skip = 0,
    } = req.query;

    const filter = {};
    if (includeInactive !== 'true') filter.isActive = true;

    if (category) {
      const categories = String(category).split(',').filter(Boolean);
      filter.category = categories.length > 1 ? { $in: categories } : categories[0];
    }

    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: pattern }, { sku: pattern }, { description: pattern }];
    }

    // Prices arrive in major units from the UI's range inputs.
    const price = {};
    if (minPrice !== undefined && minPrice !== '') price.$gte = Math.round(Number(minPrice) * 100);
    if (maxPrice !== undefined && maxPrice !== '') price.$lte = Math.round(Number(maxPrice) * 100);
    if (Object.keys(price).length) filter.priceCents = price;

    if (inStock === 'true') {
      filter.$expr = { $gt: [{ $subtract: ['$totalStock', '$reservedStock'] }, 0] };
    }

    const [products, total, categories, priceRange] = await Promise.all([
      Product.find(filter)
        .sort(SORTS[sort] ?? SORTS.relevance)
        .skip(Number(skip) || 0)
        .limit(Math.min(Number(limit) || 60, 200)),
      Product.countDocuments(filter),
      Product.distinct('category', { isActive: true }),
      // Drives the price slider's bounds without the client hardcoding them.
      Product.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, min: { $min: '$priceCents' }, max: { $max: '$priceCents' } } },
      ]),
    ]);

    res.json({
      products,
      total,
      categories: categories.sort(),
      priceRange: {
        minCents: priceRange[0]?.min ?? 0,
        maxCents: priceRange[0]?.max ?? 0,
      },
      appliedFilters: { search: search ?? '', category: category ?? '', minPrice, maxPrice, inStock, sort },
    });
  }),
);

/** Related products power the "you might also like" strip on a product page. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) throw new NotFoundError('Product');

    const related = await Product.find({
      _id: { $ne: product._id },
      category: product.category,
      isActive: true,
    })
      .sort({ name: 1 })
      .limit(4);

    res.json({ product, related });
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

    // `reservedStock` is owned by the reservation engine, never by an operator.
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
