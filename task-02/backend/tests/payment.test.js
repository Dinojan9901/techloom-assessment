import crypto from 'node:crypto';

import { jest } from '@jest/globals';

import { api, checkoutOne, createProduct, resetDb, startTestDb, stockOf, stopTestDb } from './helpers.js';
import { Payment } from '../src/models/Payment.js';

jest.setTimeout(120_000);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetDb);

describe('mock payment outcomes', () => {
  test('success confirms the order and converts held stock into sold stock', async () => {
    const product = await createProduct({ totalStock: 10 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 3 });
    const orderId = response.body.order.id;

    const payment = await api()
      .post(`/api/orders/${orderId}/pay`)
      .send({ simulate: 'success' })
      .expect(201);

    expect(payment.body.outcome).toBe('SUCCESS');
    expect(payment.body.order.status).toBe('PAID');
    expect(payment.body.order.reservedUntil).toBeNull();

    const stock = await stockOf(product._id);
    expect(stock.total).toBe(7);
    expect(stock.reserved).toBe(0);
    expect(stock.available).toBe(7);
  });

  test('failure releases the stock and marks the order FAILED', async () => {
    const product = await createProduct({ totalStock: 10 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 4 });
    const orderId = response.body.order.id;

    const payment = await api()
      .post(`/api/orders/${orderId}/pay`)
      .send({ simulate: 'failure' })
      .expect(402);

    expect(payment.body.outcome).toBe('FAILURE');
    expect(payment.body.order.status).toBe('FAILED');

    const stock = await stockOf(product._id);
    expect(stock.total).toBe(10);
    expect(stock.reserved).toBe(0);
    expect(stock.available).toBe(10);
  });

  test('timeout expires the reservation and releases the stock', async () => {
    const product = await createProduct({ totalStock: 10 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 2 });
    const orderId = response.body.order.id;

    const payment = await api()
      .post(`/api/orders/${orderId}/pay`)
      .send({ simulate: 'timeout' })
      .expect(504);

    expect(payment.body.outcome).toBe('TIMEOUT');
    expect(payment.body.order.status).toBe('EXPIRED');

    const stock = await stockOf(product._id);
    expect(stock.available).toBe(10);
    expect(stock.reserved).toBe(0);
  });

  test('a failed order cannot be retried on the same reservation', async () => {
    const product = await createProduct({ totalStock: 5 });
    const { response } = await checkoutOne({ productId: product._id });
    const orderId = response.body.order.id;

    await api().post(`/api/orders/${orderId}/pay`).send({ simulate: 'failure' }).expect(402);

    const retry = await api().post(`/api/orders/${orderId}/pay`).send({ simulate: 'success' });
    expect(retry.status).toBe(409);
    expect((await stockOf(product._id)).available).toBe(5);
  });

  test('only one payment record is ever written per order', async () => {
    const product = await createProduct({ totalStock: 5 });
    const { response } = await checkoutOne({ productId: product._id });
    const orderId = response.body.order.id;

    await Promise.all(
      Array.from({ length: 5 }, () =>
        api().post(`/api/orders/${orderId}/pay`).send({ simulate: 'success' }),
      ),
    );

    const payments = await Payment.find({ order: orderId });
    expect(payments).toHaveLength(1);
    expect(payments[0].outcome).toBe('SUCCESS');
  });
});

describe('idempotency keys', () => {
  test('a retried checkout with the same key returns the original order', async () => {
    const product = await createProduct({ totalStock: 10 });
    const { sessionId, cartId } = await import('./helpers.js').then(({ cartWith }) =>
      cartWith({ productId: product._id, quantity: 2 }),
    );

    const key = crypto.randomUUID();
    const first = await api()
      .post('/api/orders/checkout')
      .set('X-Session-Id', sessionId)
      .set('Idempotency-Key', key)
      .send({ cartId })
      .expect(201);

    const replay = await api()
      .post('/api/orders/checkout')
      .set('X-Session-Id', sessionId)
      .set('Idempotency-Key', key)
      .send({ cartId })
      .expect(201);

    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.body.order.id).toBe(first.body.order.id);

    // Crucially, the replay must not have taken a second hold.
    expect((await stockOf(product._id)).reserved).toBe(2);
  });

  test('reusing a key with a different body is rejected', async () => {
    const product = await createProduct({ totalStock: 10 });
    const { response } = await checkoutOne({ productId: product._id });
    const orderId = response.body.order.id;

    const key = crypto.randomUUID();
    await api()
      .post(`/api/orders/${orderId}/pay`)
      .set('Idempotency-Key', key)
      .send({ simulate: 'success' })
      .expect(201);

    const mismatch = await api()
      .post(`/api/orders/${orderId}/pay`)
      .set('Idempotency-Key', key)
      .send({ simulate: 'failure' });

    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('VALIDATION_ERROR');
  });
});
