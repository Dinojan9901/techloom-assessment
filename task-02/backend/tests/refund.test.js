import { jest } from '@jest/globals';

import { api, checkoutOne, createProduct, resetDb, startTestDb, stockOf, stopTestDb } from './helpers.js';
import { Refund } from '../src/models/Refund.js';

jest.setTimeout(120_000);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetDb);

/** Buys `quantity` units of a product outright and returns the order id. */
async function buy(product, quantity = 1) {
  const { response } = await checkoutOne({ productId: product._id, quantity });
  const orderId = response.body.order.id;
  await api().post(`/api/orders/${orderId}/pay`).send({ simulate: 'success' }).expect(201);
  return orderId;
}

describe('refunds', () => {
  test('a refund reverses the charge and restores the stock', async () => {
    const product = await createProduct({ totalStock: 10 });
    const orderId = await buy(product, 3);

    expect((await stockOf(product._id)).total).toBe(7);

    const response = await api()
      .post(`/api/orders/${orderId}/refund`)
      .send({ reason: 'Arrived damaged' })
      .expect(200);

    expect(response.body.order.status).toBe('REFUNDED');
    expect(response.body.refund.status).toBe('SETTLED');
    expect(response.body.refund.amountCents).toBe(response.body.order.totalCents);

    const stock = await stockOf(product._id);
    expect(stock.total).toBe(10);
    expect(stock.available).toBe(10);
    expect(stock.reserved).toBe(0);
  });

  test('an order cannot be refunded twice', async () => {
    const product = await createProduct({ totalStock: 5 });
    const orderId = await buy(product, 2);

    await api().post(`/api/orders/${orderId}/refund`).expect(200);
    const second = await api().post(`/api/orders/${orderId}/refund`);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_REQUEST');

    // The critical part: the second attempt must not have restocked again.
    expect((await stockOf(product._id)).total).toBe(5);
    expect(await Refund.countDocuments({ order: orderId })).toBe(1);
  });

  test('concurrent refund requests settle exactly one refund', async () => {
    const product = await createProduct({ totalStock: 8 });
    const orderId = await buy(product, 4);

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => api().post(`/api/orders/${orderId}/refund`)),
    );

    expect(attempts.filter((attempt) => attempt.status === 200)).toHaveLength(1);
    expect(await Refund.countDocuments({ order: orderId })).toBe(1);
    expect((await stockOf(product._id)).total).toBe(8);
  });

  test('an unpaid order is cancelled rather than refunded', async () => {
    const product = await createProduct({ totalStock: 6 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 2 });

    const cancelled = await api()
      .post(`/api/orders/${response.body.order.id}/cancel`)
      .expect(200);

    expect(cancelled.body.order.status).toBe('CANCELLED');
    expect(cancelled.body.refund).toBeNull();
    expect((await stockOf(product._id)).available).toBe(6);
  });

  test('a failed payment leaves nothing to refund', async () => {
    const product = await createProduct({ totalStock: 5 });
    const { response } = await checkoutOne({ productId: product._id });
    const orderId = response.body.order.id;

    await api().post(`/api/orders/${orderId}/pay`).send({ simulate: 'failure' }).expect(402);

    const refund = await api().post(`/api/orders/${orderId}/refund`);
    expect(refund.status).toBe(422);
    expect((await stockOf(product._id)).available).toBe(5);
  });
});

describe('order history', () => {
  test('a shopper sees only their own orders, newest first', async () => {
    const product = await createProduct({ totalStock: 20 });

    const mine = await checkoutOne({ productId: product._id, quantity: 1 });
    await checkoutOne({ productId: product._id, quantity: 1 }); // a different shopper

    const history = await api()
      .get('/api/orders')
      .set('X-Session-Id', mine.sessionId)
      .expect(200);

    expect(history.body.orders).toHaveLength(1);
    expect(history.body.orders[0].id).toBe(mine.response.body.order.id);
  });

  test('history reflects the final status of each order', async () => {
    const product = await createProduct({ totalStock: 20 });
    const sessionId = 'history-shopper';

    const first = await checkoutOne({ productId: product._id, quantity: 1, sessionId });
    await api()
      .post(`/api/orders/${first.response.body.order.id}/pay`)
      .send({ simulate: 'success' })
      .expect(201);

    const second = await checkoutOne({ productId: product._id, quantity: 1, sessionId });
    await api()
      .post(`/api/orders/${second.response.body.order.id}/pay`)
      .send({ simulate: 'failure' })
      .expect(402);

    const history = await api().get('/api/orders').set('X-Session-Id', sessionId).expect(200);

    const statuses = Object.fromEntries(
      history.body.orders.map((order) => [order.id, order.status]),
    );
    expect(statuses[first.response.body.order.id]).toBe('PAID');
    expect(statuses[second.response.body.order.id]).toBe('FAILED');
  });
});
