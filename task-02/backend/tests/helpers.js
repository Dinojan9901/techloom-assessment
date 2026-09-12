import crypto from 'node:crypto';

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import supertest from 'supertest';

import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Cart } from '../src/models/Cart.js';
import { IdempotencyKey } from '../src/models/IdempotencyKey.js';
import { Order } from '../src/models/Order.js';
import { Payment } from '../src/models/Payment.js';
import { Product } from '../src/models/Product.js';
import { Refund } from '../src/models/Refund.js';
import { Reservation } from '../src/models/Reservation.js';

let replSet;

/**
 * A single-node replica set, not a standalone mongod, because the code under
 * test uses real multi-document transactions and we want the tests exercising
 * that path rather than the fallback.
 */
export async function startTestDb() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await connectDb(replSet.getUri());
  return replSet;
}

export async function stopTestDb() {
  await disconnectDb();
  await replSet?.stop();
}

export async function resetDb() {
  await Promise.all([
    Product.deleteMany({}),
    Cart.deleteMany({}),
    Order.deleteMany({}),
    Reservation.deleteMany({}),
    Payment.deleteMany({}),
    Refund.deleteMany({}),
    IdempotencyKey.deleteMany({}),
  ]);
}

export const api = () => supertest(createApp());

export const newSession = () => `test-${crypto.randomUUID()}`;

export async function createProduct(overrides = {}) {
  return Product.create({
    name: 'Test Product',
    sku: `SKU-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    priceCents: 10_000,
    totalStock: 10,
    reservedStock: 0,
    ...overrides,
  });
}

/** Builds a one-line cart for a fresh session and returns its id. */
export async function cartWith({ productId, quantity = 1, sessionId = newSession() }) {
  const agent = api();
  await agent.get('/api/carts/current').set('X-Session-Id', sessionId).expect(200);

  const response = await agent
    .post('/api/carts/current/items')
    .set('X-Session-Id', sessionId)
    .send({ productId: String(productId), quantity })
    .expect(201);

  return { sessionId, cartId: response.body.cart.id };
}

/** Cart -> checkout in one step, returning the raw response for assertions. */
export async function checkoutOne({ productId, quantity = 1, sessionId = newSession() }) {
  const { cartId } = await cartWith({ productId, quantity, sessionId });
  const response = await api()
    .post('/api/orders/checkout')
    .set('X-Session-Id', sessionId)
    .send({ cartId });

  return { sessionId, cartId, response };
}

export async function stockOf(productId) {
  const product = await Product.findById(productId);
  return {
    total: product.totalStock,
    reserved: product.reservedStock,
    available: product.availableStock,
  };
}
