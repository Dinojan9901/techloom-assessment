import { InsufficientStockError, NotFoundError } from '../lib/errors.js';
import { Product } from '../models/Product.js';

/**
 * Holds `quantity` units of a product.
 *
 * The whole no-overselling guarantee lives in this one query. The availability
 * check is part of the update's filter, not a separate read, so MongoDB's
 * document-level atomicity does the arbitration: of N concurrent callers racing
 * for the last unit, exactly one filter matches and the rest get `null` back.
 * There is no window between "is there stock?" and "take it" for a competing
 * request to slip into.
 */
async function holdOne({ productId, quantity, session }) {
  const product = await Product.findOneAndUpdate(
    {
      _id: productId,
      isActive: true,
      $expr: { $gte: [{ $subtract: ['$totalStock', '$reservedStock'] }, quantity] },
    },
    { $inc: { reservedStock: quantity } },
    { new: true, session },
  );

  if (product) return product;

  // Distinguish "no such product" from "not enough left" for a useful error.
  const exists = await Product.findById(productId).session(session ?? null);
  if (!exists || !exists.isActive) throw new NotFoundError('Product');

  throw new InsufficientStockError({
    productId: String(productId),
    name: exists.name,
    requested: quantity,
    available: Math.max(0, exists.totalStock - exists.reservedStock),
  });
}

/**
 * Holds every line of an order, all-or-nothing.
 *
 * Inside a transaction the rollback is the abort. Without one (standalone
 * mongod) we undo the holds we already took, so a partial failure still leaves
 * inventory exactly as it was found.
 */
export async function reserveStock(items, session = null) {
  const held = [];
  try {
    // Stable ordering by product id keeps concurrent multi-item carts from
    // deadlocking against each other on the same pair of products.
    const ordered = [...items].sort((a, b) =>
      String(a.product ?? a.productId).localeCompare(String(b.product ?? b.productId)),
    );

    for (const item of ordered) {
      const productId = item.product ?? item.productId;
      await holdOne({ productId, quantity: item.quantity, session });
      held.push({ productId, quantity: item.quantity });
    }
    return held;
  } catch (error) {
    if (!session) await compensate(held);
    throw error;
  }
}

async function compensate(held) {
  for (const { productId, quantity } of held) {
    await Product.updateOne({ _id: productId }, { $inc: { reservedStock: -quantity } }).catch(
      (error) => console.error('[inventory] compensating release failed', error),
    );
  }
}

/** Hands held stock back to available inventory. */
export async function releaseStock(items, session = null) {
  for (const item of items) {
    const productId = item.product ?? item.productId;
    await Product.updateOne(
      { _id: productId, reservedStock: { $gte: item.quantity } },
      { $inc: { reservedStock: -item.quantity } },
      { session },
    );
  }
}

/**
 * Turns a hold into a sale: the units leave both the reserved pool and the
 * shelf, so `available` is unchanged (it was already reduced at reservation).
 */
export async function commitStock(items, session = null) {
  for (const item of items) {
    const productId = item.product ?? item.productId;
    const result = await Product.updateOne(
      {
        _id: productId,
        reservedStock: { $gte: item.quantity },
        totalStock: { $gte: item.quantity },
      },
      { $inc: { reservedStock: -item.quantity, totalStock: -item.quantity } },
      { session },
    );

    if (result.matchedCount === 0) {
      throw new InsufficientStockError({
        productId: String(productId),
        reason: 'Reserved stock was no longer held at settlement time',
      });
    }
  }
}

/** Puts sold units back on the shelf — cancelling or refunding a paid order. */
export async function restoreStock(items, session = null) {
  for (const item of items) {
    const productId = item.product ?? item.productId;
    await Product.updateOne(
      { _id: productId },
      { $inc: { totalStock: item.quantity } },
      { session },
    );
  }
}
