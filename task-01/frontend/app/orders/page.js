'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { api, money } from '../../lib/api.js';
import { Empty, Notice, Spinner, StatusBadge } from '../../components/ui.js';

const STATUSES = [
  'PENDING',
  'RESERVED',
  'PROCESSING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
];

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('');
  const [allTerminals, setAllTerminals] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (allTerminals) params.set('all', 'true');

    const data = await api(`/api/orders?${params}`);
    setOrders(data.orders);
  }, [status, allTerminals]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [load]);

  /**
   * The sweeper runs on its own every 15 seconds; this just makes it happen
   * now, so an expiry can be demonstrated without waiting for the next tick.
   */
  async function sweep() {
    setSweeping(true);
    setSweepResult('');
    try {
      const data = await api('/api/admin/sweep', { method: 'POST' });
      setSweepResult(
        `Released ${data.expiredReservations} expired reservation(s) and closed ${data.closedOrders} stale order(s).`,
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSweeping(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p className="subtitle">
            Every order, its current status, and what it is doing to inventory right now.
          </p>
        </div>
        <button type="button" onClick={sweep} disabled={sweeping}>
          {sweeping ? <Spinner /> : null}
          Run expiry sweep now
        </button>
      </div>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>
      <Notice tone="ok" onDismiss={() => setSweepResult('')}>
        {sweepResult}
      </Notice>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <label className="row small" style={{ margin: 0, gap: 7 }}>
          <input
            type="checkbox"
            checked={allTerminals}
            onChange={(event) => setAllTerminals(event.target.checked)}
            style={{ width: 'auto' }}
          />
          Show every terminal
        </label>
      </div>

      <div className="card">
        {loading ? (
          <Empty>
            <Spinner /> Loading orders…
          </Empty>
        ) : orders.length === 0 ? (
          <Empty>No orders yet. Ring one up on the Register.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th className="num">Items</th>
                  <th className="num">Total</th>
                  <th>Placed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="mono">{order.orderNumber}</td>
                    <td>{order.customer?.name || '—'}</td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="num">
                      {order.items.reduce((sum, item) => sum + item.quantity, 0)}
                    </td>
                    <td className="num">{money(order.totalCents)}</td>
                    <td className="small muted">{new Date(order.createdAt).toLocaleString()}</td>
                    <td>
                      <Link className="btn btn-sm" href={`/orders/${order.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
