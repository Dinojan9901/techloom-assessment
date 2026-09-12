import { jest } from '@jest/globals';

import {
  api,
  cartWith,
  checkoutOne,
  createProduct,
  resetDb,
  startTestDb,
  stockOf,
  stopTestDb,
} from './helpers.js';
import { env } from '../src/config/env.js';
import { Order } from '../src/models/Order.js';
import { Reservation, RESERVATION_STATUS } from '../src/models/Reservation.js';

jest.setTimeout(120_000);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetDb);

/** Fast-forwards a reservation instead of waiting five real minutes. */
async function expireNow(orderId) {
  const order = await Order.findById(orderId);
  const past = new Date(Date.now() - 1000);
  await Reservation.updateOne({ _id: order.reservation }, { $set: { expiresAt: past } });
  await Order.updateOne({ _id: orderId }, { $set: { reservedUntil: past } });
}

describe('stock reservation', () => {
  test('checkout holds stock and sets a five-minute window', async () => {
    const product = await createProduct({ totalStock: 10 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 3 });

    expect(response.status).toBe(201);
    expect(response.body.order.status).toBe('RESERVED');

    const windowMs = new Date(response.body.reservationExpiresAt).getTime() - Date.now();
    expect(windowMs).toBeGreaterThan(env.reservationTtlMs - 10_000);
    expect(windowMs).toBeLessThanOrEqual(env.reservationTtlMs);

    const stock = await stockOf(product._id);
    expect(stock.reserved).toBe(3);
    expect(stock.available).toBe(7);
    expect(stock.total).toBe(10);
  });

  test('an expired reservation releases its stock and expires the order', async () => {
    const product = await createProduct({ totalStock: 4 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 4 });
    const orderId = response.body.order.id;

    expect((await stockOf(product._id)).available).toBe(0);

    await expireNow(orderId);
    const sweep = await api().post('/api/admin/sweep').expect(200);
    expect(sweep.body.expiredReservations).toBe(1);

    const after = await stockOf(product._id);
    expect(after.available).toBe(4);
    expect(after.reserved).toBe(0);
    expect(after.total).toBe(4);

    const order = await Order.findById(orderId);
    expect(order.status).toBe('EXPIRED');

    const reservation = await Reservation.findById(order.reservation);
    expect(reservation.status).toBe(RESERVATION_STATUS.RELEASED);
  });

  test('sweeping twice releases the stock only once', async () => {
    const product = await createProduct({ totalStock: 6 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 2 });

    await expireNow(response.body.order.id);
    await api().post('/api/admin/sweep').expect(200);
    const second = await api().post('/api/admin/sweep').expect(200);

    expect(second.body.expiredReservations).toBe(0);
    const stock = await stockOf(product._id);
    expect(stock.available).toBe(6);
    expect(stock.reserved).toBe(0);
  });

  test('paying an expired order is refused', async () => {
    const product = await createProduct({ totalStock: 2 });
    const { response } = await checkoutOne({ productId: product._id });
    const orderId = response.body.order.id;

    await expireNow(orderId);

    const payment = await api().post(`/api/orders/${orderId}/pay`).send({ simulate: 'success' });
    expect(payment.status).toBe(410);
    expect(payment.body.error.code).toBe('RESERVATION_EXPIRED');
  });
});

describe('order lifecycle', () => {
  test('cancelling a reserved order returns the held stock', async () => {
    const product = await createProduct({ totalStock: 8 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 5 });
    const orderId = response.body.order.id;

    const cancelled = await api()
      .post(`/api/orders/${orderId}/cancel`)
      .send({ reason: 'Customer changed their mind' })
      .expect(200);

    expect(cancelled.body.order.status).toBe('CANCELLED');

    const stock = await stockOf(product._id);
    expect(stock.available).toBe(8);
    expect(stock.reserved).toBe(0);
    expect(stock.total).toBe(8);
  });

  test('cancelling a paid order puts the sold units back on the shelf', async () => {
    const product = await createProduct({ totalStock: 6 });
    const { response } = await checkoutOne({ productId: product._id, quantity: 2 });
    const orderId = response.body.order.id;

    await api().post(`/api/orders/${orderId}/pay`).send({ simulate: 'success' }).expect(201);
    expect((await stockOf(product._id)).total).toBe(4);

    await api().post(`/api/orders/${orderId}/cancel`).expect(200);

    const stock = await stockOf(product._id);
    expect(stock.total).toBe(6);
    expect(stock.available).toBe(6);
    expect(stock.reserved).toBe(0);
  });

  test('a cancelled order cannot be cancelled again', async () => {
    const product = await createProduct({ totalStock: 3 });
    const { response } = await checkoutOne({ productId: product._id });
    const orderId = response.body.order.id;

    await api().post(`/api/orders/${orderId}/cancel`).expect(200);
    const second = await api().post(`/api/orders/${orderId}/cancel`);

    expect(second.status).toBe(409);
    expect((await stockOf(product._id)).available).toBe(3);
  });

  test('every status change is recorded in order history', async () => {
    const product = await createProduct({ totalStock: 3 });
    const { response } = await checkoutOne({ productId: product._id });
    const orderId = response.body.order.id;

    await api().post(`/api/orders/${orderId}/pay`).send({ simulate: 'success' }).expect(201);

    const order = await Order.findById(orderId);
    expect(order.statusHistory.map((event) => event.status)).toEqual([
      'PENDING',
      'RESERVED',
      'PROCESSING',
      'PAID',
    ]);
  });

  test('a cart cannot be checked out twice', async () => {
    const product = await createProduct({ totalStock: 10 });
    const { sessionId, cartId } = await cartWith({ productId: product._id, quantity: 1 });

    await api()
      .post('/api/orders/checkout')
      .set('X-Session-Id', sessionId)
      .send({ cartId })
      .expect(201);

    const second = await api()
      .post('/api/orders/checkout')
      .set('X-Session-Id', sessionId)
      .send({ cartId });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_REQUEST');
    expect((await stockOf(product._id)).reserved).toBe(1);
  });
});
