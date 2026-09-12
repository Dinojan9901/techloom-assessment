import { jest } from '@jest/globals';

import {
  api,
  checkoutOne,
  createProduct,
  newSession,
  resetDb,
  startTestDb,
  stockOf,
  stopTestDb,
} from './helpers.js';

jest.setTimeout(120_000);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetDb);

describe('no overselling under concurrent load', () => {
  test('50 simultaneous checkouts for 5 units reserve exactly 5', async () => {
    const product = await createProduct({ name: 'Last Five Mugs', totalStock: 5 });

    const attempts = await Promise.all(
      Array.from({ length: 50 }, () => checkoutOne({ productId: product._id })),
    );

    const succeeded = attempts.filter(({ response }) => response.status === 201);
    const rejected = attempts.filter(({ response }) => response.status === 409);

    expect(succeeded).toHaveLength(5);
    expect(rejected).toHaveLength(45);
    expect(rejected.every(({ response }) => response.body.error.code === 'INSUFFICIENT_STOCK')).toBe(
      true,
    );

    const stock = await stockOf(product._id);
    expect(stock.reserved).toBe(5);
    expect(stock.available).toBe(0);
    // Nothing has been sold yet - the units are held, not gone.
    expect(stock.total).toBe(5);
  });

  test('multi-unit checkouts never let reserved stock exceed total stock', async () => {
    const product = await createProduct({ name: 'Bulk Beans', totalStock: 20 });

    const attempts = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        checkoutOne({ productId: product._id, quantity: (index % 3) + 1 }),
      ),
    );

    const reservedUnits = attempts
      .filter(({ response }) => response.status === 201)
      .reduce((sum, { response }) => sum + response.body.order.items[0].quantity, 0);

    const stock = await stockOf(product._id);
    expect(stock.reserved).toBe(reservedUnits);
    expect(stock.reserved).toBeLessThanOrEqual(20);
    expect(stock.available).toBe(20 - reservedUnits);
  });

  test('a multi-line cart is all-or-nothing: a short line holds nothing', async () => {
    const plenty = await createProduct({ name: 'Plenty', totalStock: 50 });
    const scarce = await createProduct({ name: 'Scarce', totalStock: 1 });

    const sessionId = newSession();
    const agent = api();
    await agent.get('/api/carts/current').set('X-Session-Id', sessionId);

    await agent
      .post('/api/carts/current/items')
      .set('X-Session-Id', sessionId)
      .send({ productId: String(plenty._id), quantity: 2 })
      .expect(201);

    const cart = await agent
      .post('/api/carts/current/items')
      .set('X-Session-Id', sessionId)
      .send({ productId: String(scarce._id), quantity: 1 })
      .expect(201);

    // Someone else takes the only scarce unit while this cart sits there. The
    // cart was valid when it was built; it is no longer fillable.
    const competitor = await checkoutOne({ productId: scarce._id, quantity: 1 });
    expect(competitor.response.status).toBe(201);

    const response = await api()
      .post('/api/orders/checkout')
      .set('X-Session-Id', sessionId)
      .send({ cartId: cart.body.cart.id });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');

    // The line that *was* available must not have been left held.
    const plentyStock = await stockOf(plenty._id);
    expect(plentyStock.reserved).toBe(0);
    expect(plentyStock.available).toBe(50);
  });

  test('concurrent payments on the same order charge exactly once', async () => {
    const product = await createProduct({ totalStock: 5 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 2 });
    const orderId = response.body.order.id;

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        api().post(`/api/orders/${orderId}/pay`).send({ simulate: 'success' }),
      ),
    );

    const paid = attempts.filter((attempt) => attempt.status === 201);
    const duplicates = attempts.filter((attempt) => attempt.status === 409);

    expect(paid).toHaveLength(1);
    expect(duplicates).toHaveLength(7);
    expect(duplicates.every((attempt) => attempt.body.error.code === 'DUPLICATE_REQUEST')).toBe(
      true,
    );

    const stock = await stockOf(product._id);
    expect(stock.total).toBe(3);
    expect(stock.reserved).toBe(0);
    expect(stock.available).toBe(3);
  });
});
