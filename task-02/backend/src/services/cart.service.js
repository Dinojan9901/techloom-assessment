import { NotFoundError, ValidationError } from '../lib/errors.js';
import { Cart, CART_STATUS } from '../models/Cart.js';
import { Product } from '../models/Product.js';

const populateItems = (query) =>
  query.populate({
    path: 'items.product',
    select: 'name sku priceCents totalStock reservedStock imageUrl category isActive',
  });

/** One open cart per POS session; created on first use. */
export async function getOrCreateCart(sessionId) {
  const existing = await populateItems(Cart.findOne({ sessionId, status: CART_STATUS.OPEN }));
  if (existing) return existing;

  const cart = await Cart.create({ sessionId, items: [] });
  return populateItems(Cart.findById(cart._id));
}

export async function getCart(cartId) {
  const cart = await populateItems(Cart.findById(cartId));
  if (!cart) throw new NotFoundError('Cart');
  return cart;
}

async function openCartOrThrow(sessionId) {
  const cart = await Cart.findOne({ sessionId, status: CART_STATUS.OPEN });
  if (!cart) throw new NotFoundError('Open cart');
  return cart;
}

export async function addItem({ sessionId, productId, quantity }) {
  const product = await Product.findOne({ _id: productId, isActive: true });
  if (!product) throw new NotFoundError('Product');

  const cart = await openCartOrThrow(sessionId);
  const line = cart.items.find((item) => String(item.product) === String(productId));
  const nextQuantity = (line?.quantity ?? 0) + quantity;

  // An advisory check only — availability is re-decided atomically at checkout.
  if (nextQuantity > product.availableStock) {
    throw new ValidationError(
      `Only ${product.availableStock} unit(s) of ${product.name} are available`,
      [{ field: 'quantity', message: `Maximum available is ${product.availableStock}` }],
    );
  }

  if (line) line.quantity = nextQuantity;
  else cart.items.push({ product: productId, quantity });

  await cart.save();
  return populateItems(Cart.findById(cart._id));
}

export async function setItemQuantity({ sessionId, productId, quantity }) {
  const cart = await openCartOrThrow(sessionId);

  if (quantity <= 0) {
    cart.items = cart.items.filter((item) => String(item.product) !== String(productId));
  } else {
    const line = cart.items.find((item) => String(item.product) === String(productId));
    if (!line) throw new NotFoundError('Cart item');

    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    if (quantity > product.availableStock) {
      throw new ValidationError(
        `Only ${product.availableStock} unit(s) of ${product.name} are available`,
        [{ field: 'quantity', message: `Maximum available is ${product.availableStock}` }],
      );
    }
    line.quantity = quantity;
  }

  await cart.save();
  return populateItems(Cart.findById(cart._id));
}

export async function removeItem({ sessionId, productId }) {
  return setItemQuantity({ sessionId, productId, quantity: 0 });
}

export async function clearCart(sessionId) {
  const cart = await openCartOrThrow(sessionId);
  cart.items = [];
  await cart.save();
  return populateItems(Cart.findById(cart._id));
}

export function summariseCart(cart) {
  const items = cart.items
    .filter((item) => item.product)
    .map((item) => ({
      productId: String(item.product._id ?? item.product),
      name: item.product.name,
      sku: item.product.sku,
      unitPriceCents: item.product.priceCents,
      quantity: item.quantity,
      lineTotalCents: item.product.priceCents * item.quantity,
      availableStock: item.product.availableStock,
    }));

  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);

  return {
    id: String(cart._id),
    sessionId: cart.sessionId,
    status: cart.status,
    items,
    subtotalCents,
    totalCents: subtotalCents,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}
