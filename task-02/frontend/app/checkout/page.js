'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { api, money, newIdempotencyKey } from '../../lib/api.js';
import { useCart } from '../../components/cart-context.js';
import { Countdown, Empty, Notice, Spinner } from '../../components/ui.js';

const CARDS = [
  { simulate: 'success', label: 'Approved card', hint: '4242 · always succeeds' },
  { simulate: 'failure', label: 'Declined card', hint: '4000 · always declines' },
  { simulate: 'timeout', label: 'Unresponsive gateway', hint: '0000 · always times out' },
  { simulate: 'auto', label: 'Real-world card', hint: 'Random: mostly approves, sometimes not' },
];

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, loading: cartLoading, refresh } = useCart();

  const [step, setStep] = useState('details');
  const [order, setOrder] = useState(null);
  const [customer, setCustomer] = useState({ name: '', email: '' });
  const [card, setCard] = useState('success');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /**
   * Once stock is held, the server owns the clock. Polling means an expiry
   * triggered by the sweeper reaches this screen even though nothing here
   * caused it — the customer finds out before pressing Pay, not after.
   */
  const refreshOrder = useCallback(async () => {
    if (!order?.id) return;
    try {
      const payload = await api(`/api/orders/${order.id}`);
      setOrder(payload.order);
      if (payload.order.status === 'EXPIRED') setStep('expired');
    } catch {
      /* transient network trouble shouldn't blank the screen */
    }
  }, [order?.id]);

  useEffect(() => {
    if (step !== 'payment') return undefined;
    const timer = setInterval(refreshOrder, 3000);
    return () => clearInterval(timer);
  }, [step, refreshOrder]);

  async function reserve(event) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const payload = await api('/api/orders/checkout', {
        method: 'POST',
        // Survives a double-submit or a retried request: one cart, one order.
        idempotencyKey: newIdempotencyKey(),
        body: { cartId: cart.id, customer },
      });
      setOrder(payload.order);
      setStep('payment');
      await refresh();
    } catch (err) {
      setError(err.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setBusy(true);
    setError('');

    try {
      const payload = await api(`/api/orders/${order.id}/pay`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: card === 'auto' ? {} : { simulate: card },
      });

      if (payload.outcome === 'SUCCESS') {
        router.push(`/orders/${order.id}?placed=1`);
        return;
      }

      // A decline or a timeout: the hold is already gone, so send the shopper
      // to the order where the outcome and what to do next are spelled out.
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setError(err.message);
      await refreshOrder();
    } finally {
      setBusy(false);
    }
  }

  if (cartLoading) {
    return (
      <main className="page">
        <div className="row">
          <Spinner /> <span className="muted">Loading checkout…</span>
        </div>
      </main>
    );
  }

  if (step === 'details' && !cart?.items?.length) {
    return (
      <main className="page">
        <div className="card">
          <Empty>
            There is nothing to check out.{' '}
            <Link href="/" style={{ textDecoration: 'underline' }}>
              Browse the shop
            </Link>
          </Empty>
        </div>
      </main>
    );
  }

  const lines = step === 'details' ? cart.items : order.items;
  const total = step === 'details' ? cart.totalCents : order.totalCents;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Checkout</h1>
          <p className="subtitle">
            {step === 'details'
              ? 'Confirm your details, then we hold your items while you pay.'
              : 'Your items are held. Complete payment before the timer runs out.'}
          </p>
        </div>
      </div>

      <div className="steps">
        <span className="step" data-state={step === 'details' ? 'active' : 'done'}>
          1 · Your details
        </span>
        <span
          className="step"
          data-state={step === 'payment' ? 'active' : step === 'details' ? 'todo' : 'done'}
        >
          2 · Stock reserved
        </span>
        <span className="step" data-state={step === 'payment' ? 'active' : 'todo'}>
          3 · Payment
        </span>
      </div>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>

      {step === 'expired' ? (
        <div className="card card-pad stack" style={{ marginTop: 16 }}>
          <h2>Your reservation expired</h2>
          <p className="muted" style={{ margin: 0 }}>
            The five-minute hold ran out, so your items went back on sale for everyone else. Nothing
            was charged.
          </p>
          <div className="row">
            <Link className="btn btn-primary" href="/">
              Back to the shop
            </Link>
            <Link className="btn" href={`/orders/${order?.id}`}>
              View the expired order
            </Link>
          </div>
        </div>
      ) : (
        <div className="split" style={{ marginTop: 16 }}>
          <section className="card card-pad stack">
            {step === 'details' ? (
              <form onSubmit={reserve} className="stack">
                <h2>Your details</h2>
                <div className="field">
                  <label htmlFor="name">Full name</label>
                  <input
                    id="name"
                    required
                    value={customer.name}
                    onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                    placeholder="Ada Lovelace"
                  />
                </div>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={customer.email}
                    onChange={(event) => setCustomer({ ...customer, email: event.target.value })}
                    placeholder="ada@example.com"
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? <Spinner /> : null}
                  Reserve my items &amp; continue
                </button>
                <p className="small muted" style={{ margin: 0 }}>
                  If any item sells out in the meantime, nothing is reserved and your cart stays as
                  it is.
                </p>
              </form>
            ) : (
              <div className="stack">
                <h2>Payment</h2>
                <p className="small muted" style={{ margin: 0 }}>
                  This is a simulated gateway. Pick a card to choose how it behaves — every branch
                  is handled for real on the server.
                </p>

                <div className="stack" style={{ gap: 8 }}>
                  {CARDS.map((option) => (
                    <label
                      key={option.simulate}
                      className="card card-pad row"
                      style={{
                        gap: 12,
                        cursor: 'pointer',
                        borderColor:
                          card === option.simulate ? 'var(--accent)' : 'var(--border)',
                        marginBottom: 0,
                      }}
                    >
                      <input
                        type="radio"
                        name="card"
                        value={option.simulate}
                        checked={card === option.simulate}
                        onChange={(event) => setCard(event.target.value)}
                        style={{ width: 'auto' }}
                      />
                      <span>
                        <span style={{ fontWeight: 560 }}>{option.label}</span>
                        <br />
                        <span className="small muted">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <button
                  type="button"
                  className="btn-primary btn-block"
                  onClick={pay}
                  disabled={busy || order.status !== 'RESERVED'}
                >
                  {busy ? <Spinner /> : null}
                  Pay {money(total)}
                </button>

                <button
                  type="button"
                  className="btn-danger btn-block"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(`/api/orders/${order.id}/cancel`, {
                        method: 'POST',
                        idempotencyKey: newIdempotencyKey(),
                        body: { reason: 'Abandoned at payment' },
                      });
                      router.push('/');
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  Cancel and release my items
                </button>
              </div>
            )}
          </section>

          <aside className="card card-pad sticky stack">
            {step === 'payment' ? (
              <div>
                <label>Items held for</label>
                <Countdown expiresAt={order.reservedUntil} onExpire={refreshOrder} />
                <p className="small muted" style={{ margin: '6px 0 0' }}>
                  After this, your items go back on sale automatically.
                </p>
              </div>
            ) : null}

            <h2>Order summary</h2>
            <div className="stack" style={{ gap: 8 }}>
              {lines.map((item) => (
                <div key={item.sku ?? item.productId} className="between">
                  <span>
                    {item.name}{' '}
                    <span className="muted small">× {item.quantity}</span>
                  </span>
                  <span className="num">{money(item.unitPriceCents * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="between" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <strong>Total</strong>
              <strong className="num" style={{ fontSize: '1.15rem' }}>
                {money(total)}
              </strong>
            </div>
            {step === 'payment' ? (
              <p className="small muted mono" style={{ margin: 0 }}>
                {order.orderNumber}
              </p>
            ) : null}
          </aside>
        </div>
      )}
    </main>
  );
}
