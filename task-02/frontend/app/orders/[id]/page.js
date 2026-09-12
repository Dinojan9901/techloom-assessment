'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

import { api, money, newIdempotencyKey } from '../../../lib/api.js';
import { ProductImage } from '../../../components/product-image.js';
import { Countdown, Notice, Spinner, StatusBadge } from '../../../components/ui.js';

const OUTCOME_TONE = { SUCCESS: 'ok', FAILURE: 'danger', TIMEOUT: 'warn' };

const STATUS_COPY = {
  RESERVED: 'Your items are held while you complete payment.',
  PROCESSING: 'We are waiting on the payment gateway.',
  PAID: 'Payment captured. Your order is confirmed.',
  FAILED: 'The payment did not go through, so nothing was charged and your items went back on sale.',
  EXPIRED: 'The reservation ran out before payment completed. Nothing was charged.',
  CANCELLED: 'You cancelled this order and the items were released.',
  REFUNDED: 'This order was refunded to your original payment method.',
};

function OrderDetail() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const justPlaced = searchParams.get('placed') === '1';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const payload = await api(`/api/orders/${id}`);
    setData(payload);
    return payload;
  }, [id]);

  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [load]);

  const order = data?.order;
  const holding = order && ['PENDING', 'RESERVED', 'PROCESSING'].includes(order.status);

  useEffect(() => {
    if (!holding) return undefined;
    const timer = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [holding, load]);

  async function act(path, body, successMessage) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = await api(path, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body,
      });
      setMessage(payload.message ?? successMessage);
      await load();
    } catch (err) {
      setError(err.message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <div className="row">
          <Spinner /> <span className="muted">Loading order…</span>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="page">
        <Notice tone="danger">{error || 'Order not found.'}</Notice>
        <Link className="btn" href="/orders" style={{ marginTop: 16 }}>
          My orders
        </Link>
      </main>
    );
  }

  return (
    <main className="page">
      {justPlaced && order.status === 'PAID' ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="ok">
            <strong>Thanks — your order is confirmed.</strong> A receipt would normally be on its
            way to {order.customer?.email || 'your email'}.
          </Notice>
        </div>
      ) : null}

      <div className="page-head">
        <div>
          <h1 className="mono">{order.orderNumber}</h1>
          <p className="subtitle">
            Placed {new Date(order.createdAt).toLocaleString()} · {order.customer?.name}
          </p>
        </div>
        <div className="row">
          <StatusBadge status={order.status} />
          <Link className="btn btn-sm" href="/orders">
            My orders
          </Link>
        </div>
      </div>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>
      <Notice tone="ok" onDismiss={() => setMessage('')}>
        {message}
      </Notice>

      <div className="split" style={{ marginTop: 16 }}>
        <section className="stack">
          <div className="card">
            <div className="card-pad">
              <h2>Items</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th colSpan={2}>Product</th>
                    <th className="num">Unit</th>
                    <th className="num">Qty</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.sku}>
                      <td style={{ width: 58 }}>
                        <ProductImage sku={item.sku} name={item.name} size="thumb" />
                      </td>
                      <td>
                        <div style={{ fontWeight: 540 }}>{item.name}</div>
                        <div className="small muted mono">{item.sku}</div>
                      </td>
                      <td className="num">{money(item.unitPriceCents)}</td>
                      <td className="num">{item.quantity}</td>
                      <td className="num">{money(item.unitPriceCents * item.quantity)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>
                      Total
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {money(order.totalCents)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad stack">
            <h2>Progress</h2>
            <ul className="timeline">
              {order.statusHistory.map((event, index) => (
                <li key={`${event.status}-${index}`}>
                  <div className="row" style={{ gap: 8 }}>
                    <StatusBadge status={event.status} />
                    <span className="small muted">{new Date(event.at).toLocaleTimeString()}</span>
                  </div>
                  {event.reason ? <div className="small muted">{event.reason}</div> : null}
                </li>
              ))}
            </ul>
          </div>

          {data.payments?.length ? (
            <div className="card">
              <div className="card-pad">
                <h2>Payments</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Outcome</th>
                      <th>Reference</th>
                      <th>Detail</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((payment) => (
                      <tr key={payment._id ?? payment.id}>
                        <td>
                          <span className="badge" data-tone={OUTCOME_TONE[payment.outcome]}>
                            {payment.outcome}
                          </span>
                        </td>
                        <td className="mono muted">{payment.gatewayReference}</td>
                        <td>{payment.message}</td>
                        <td className="num">{money(payment.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {data.refunds?.length ? (
            <div className="card">
              <div className="card-pad">
                <h2>Refunds</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Reference</th>
                      <th>Reason</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.refunds.map((refund) => (
                      <tr key={refund._id ?? refund.id}>
                        <td>
                          <span className="badge" data-tone="ok">
                            {refund.status}
                          </span>
                        </td>
                        <td className="mono muted">{refund.gatewayReference}</td>
                        <td>{refund.note || refund.reason}</td>
                        <td className="num">{money(refund.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="card card-pad sticky stack">
          {holding ? (
            <div>
              <label>Items held for</label>
              <Countdown expiresAt={order.reservedUntil} onExpire={() => load().catch(() => {})} />
            </div>
          ) : null}

          <p className="small muted" style={{ margin: 0 }}>
            {STATUS_COPY[order.status] ?? ''}
          </p>

          {order.status === 'RESERVED' ? (
            <Link className="btn btn-primary btn-block" href="/checkout">
              Continue to payment
            </Link>
          ) : null}

          {holding && order.status !== 'PROCESSING' ? (
            <button
              type="button"
              className="btn-danger btn-block"
              onClick={() =>
                act(`/api/orders/${id}/cancel`, { reason: 'Cancelled by customer' }, 'Order cancelled.')
              }
              disabled={busy}
            >
              {busy ? <Spinner /> : null}
              Cancel this order
            </button>
          ) : null}

          {order.status === 'PAID' ? (
            <>
              <button
                type="button"
                className="btn-danger btn-block"
                onClick={() =>
                  act(
                    `/api/orders/${id}/refund`,
                    { reason: 'Changed my mind' },
                    'Refund settled.',
                  )
                }
                disabled={busy}
              >
                {busy ? <Spinner /> : null}
                Cancel &amp; request a refund
              </button>
              <p className="small muted" style={{ margin: 0 }}>
                The charge is reversed and the items go straight back on sale.
              </p>
            </>
          ) : null}

          {['FAILED', 'EXPIRED', 'CANCELLED'].includes(order.status) ? (
            <Link className="btn btn-primary btn-block" href="/">
              Shop again
            </Link>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

export default function OrderDetailPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense
      fallback={
        <main className="page">
          <div className="row">
            <Spinner /> <span className="muted">Loading order…</span>
          </div>
        </main>
      }
    >
      <OrderDetail />
    </Suspense>
  );
}
