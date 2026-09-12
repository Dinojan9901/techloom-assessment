'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { api, money } from '../../lib/api.js';
import { Empty, Notice, Spinner, StatusBadge } from '../../components/ui.js';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'PAID', label: 'Paid' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'FAILED,EXPIRED', label: 'Unsuccessful' },
];

export default function OrderHistoryPage() {
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const data = await api(`/api/orders?${params}`);
    setOrders(data.orders);
  }, [status]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [load]);

  // An order can change without the shopper doing anything — a reservation can
  // lapse while this page is open.
  useEffect(() => {
    const timer = setInterval(() => load().catch(() => {}), 6000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>My orders</h1>
          <p className="subtitle">Every order from this browser, and where each one ended up.</p>
        </div>
      </div>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>

      <div className="chip-row" style={{ margin: '16px 0' }}>
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className="chip"
            data-active={status === filter.value}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <Empty>
            <Spinner /> Loading your orders…
          </Empty>
        ) : orders.length === 0 ? (
          <Empty>
            No orders here yet.{' '}
            <Link href="/" style={{ textDecoration: 'underline' }}>
              Find something to buy
            </Link>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Items</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="mono">{order.orderNumber}</td>
                    <td className="small muted">
                      {new Date(order.createdAt).toLocaleDateString()}{' '}
                      {new Date(order.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>
                      <div>{order.items[0]?.name}</div>
                      {order.items.length > 1 ? (
                        <div className="small muted">
                          and {order.items.length - 1} more item
                          {order.items.length - 1 === 1 ? '' : 's'}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="num">{money(order.totalCents)}</td>
                    <td>
                      <Link className="btn btn-sm" href={`/orders/${order.id}`}>
                        Details
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
