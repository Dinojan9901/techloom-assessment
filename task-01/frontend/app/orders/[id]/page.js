'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { api, money, newIdempotencyKey } from '../../../lib/api.js';
import { Countdown, Notice, Spinner, StatusBadge } from '../../../components/ui.js';

const OUTCOME_TONE = { SUCCESS: 'ok', FAILURE: 'danger', TIMEOUT: 'warn' };

const PAY_BUTTONS = [
  { simulate: 'auto', label: 'Pay (random outcome)', primary: true },
  { simulate: 'success', label: 'Force success' },
  { simulate: 'failure', label: 'Force decline' },
  { simulate: 'timeout', label: 'Force timeout' },
];

export default function OrderDetailPage() {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

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
  const isHolding = order && ['PENDING', 'RESERVED', 'PROCESSING'].includes(order.status);

  /**
   * While stock is held, the server is the authority on whether the hold is
   * still alive — the sweeper can expire it at any moment. Poll so the screen
   * cannot keep offering a Pay button for a reservation that has already gone.
   */
  useEffect(() => {
    if (!isHolding) return undefined;
    const timer = setInterval(() => {
      load().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [isHolding, load]);

  async function pay(simulate) {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const payload = await api(`/api/orders/${id}/pay`, {
        method: 'POST',
        // One key per attempt: a retried *network* call replays the original
        // result instead of charging again.
        idempotencyKey: newIdempotencyKey(),
        body: simulate === 'auto' ? {} : { simulate },
      });

      if (payload.outcome) {
        setResult({ outcome: payload.outcome, message: payload.message });
      }
      await load();
    } catch (err) {
      setError(err.message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/orders/${id}/cancel`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: { reason: 'Cancelled at the till' },
      });
      await load();
    } catch (err) {
      setError(err.message);
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
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="mono">{order.orderNumber}</h1>
          <p className="subtitle">
            {order.customer?.name} · placed {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="row">
          <StatusBadge status={order.status} />
          <Link className="btn btn-sm" href="/orders">
            All orders
          </Link>
        </div>
      </div>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>

      {result ? (
        <div style={{ marginTop: 12 }}>
          <Notice tone={OUTCOME_TONE[result.outcome]} onDismiss={() => setResult(null)}>
            <strong>{result.outcome}</strong> — {result.message}
          </Notice>
        </div>
      ) : null}

      <div className="split" style={{ marginTop: 16 }}>
        <section className="stack">
          <div className="card">
            <div className="card-pad between">
              <h2>Items</h2>
              <span className="muted small">{order.items.length} line(s)</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th className="num">Unit</th>
                    <th className="num">Qty</th>
                    <th className="num">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.sku}>
                      <td>{item.name}</td>
                      <td className="mono muted">{item.sku}</td>
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
            <h2>Lifecycle</h2>
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
            {data.allowedTransitions?.length ? (
              <p className="small muted" style={{ margin: 0 }}>
                Valid next states: {data.allowedTransitions.join(', ')}
              </p>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                This order has reached a final state.
              </p>
            )}
          </div>

          {data.payments?.length ? (
            <div className="card">
              <div className="card-pad">
                <h2>Payment attempts</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Outcome</th>
                      <th>Gateway reference</th>
                      <th>Message</th>
                      <th className="num">Latency</th>
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
                        <td className="num">{payment.latencyMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="card card-pad sticky stack">
          {isHolding ? (
            <>
              <div>
                <label>Stock held for</label>
                <Countdown expiresAt={order.reservedUntil} onExpire={() => load().catch(() => {})} />
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                When this reaches zero the reservation is released automatically and these units go
                back on sale.
              </p>

              <div className="stack" style={{ gap: 8 }}>
                {PAY_BUTTONS.map(({ simulate, label, primary }) => (
                  <button
                    key={simulate}
                    type="button"
                    className={`btn-block${primary ? ' btn-primary' : ''}`}
                    onClick={() => pay(simulate)}
                    disabled={busy || order.status === 'PROCESSING'}
                  >
                    {busy ? <Spinner /> : null}
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="btn-danger btn-block"
                onClick={cancel}
                disabled={busy || order.status === 'PROCESSING'}
              >
                Cancel order
              </button>
            </>
          ) : (
            <>
              <div>
                <label>Final status</label>
                <StatusBadge status={order.status} />
              </div>
              {order.failureReason ? (
                <p className="small muted" style={{ margin: 0 }}>
                  {order.failureReason}
                </p>
              ) : null}

              {order.status === 'PAID' ? (
                <button
                  type="button"
                  className="btn-danger btn-block"
                  onClick={cancel}
                  disabled={busy}
                >
                  Cancel &amp; restore stock
                </button>
              ) : null}

              <Link className="btn btn-block" href="/">
                Start a new sale
              </Link>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
