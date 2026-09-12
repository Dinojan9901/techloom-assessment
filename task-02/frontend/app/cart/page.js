'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { money } from '../../lib/api.js';
import { useCart } from '../../components/cart-context.js';
import { ProductImage } from '../../components/product-image.js';
import { Empty, Notice, Spinner } from '../../components/ui.js';

export default function CartPage() {
  const router = useRouter();
  const { cart, loading, setQuantity, clear } = useCart();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
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
          <Spinner /> <span className="muted">Loading your cart…</span>
        </div>
      </main>
    );
  }

  const items = cart?.items ?? [];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Your cart</h1>
          <p className="subtitle">
            Nothing is held for you yet — stock is reserved when you start checkout.
          </p>
        </div>
        {items.length ? (
          <button type="button" onClick={() => run(clear)} disabled={busy}>
            Empty cart
          </button>
        ) : null}
      </div>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>

      {items.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <Empty>
            Your cart is empty.{' '}
            <Link href="/" style={{ textDecoration: 'underline' }}>
              Browse the shop
            </Link>
          </Empty>
        </div>
      ) : (
        <div className="split" style={{ marginTop: 16 }}>
          <section className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th colSpan={2}>Item</th>
                    <th className="num">Price</th>
                    <th>Quantity</th>
                    <th className="num">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.productId}>
                      <td style={{ width: 58 }}>
                        <ProductImage sku={item.sku} name={item.name} size="thumb" />
                      </td>
                      <td>
                        <Link href={`/products/${item.productId}`} style={{ fontWeight: 540 }}>
                          {item.name}
                        </Link>
                        <div className="small muted mono">{item.sku}</div>
                        {item.quantity > item.availableStock ? (
                          <div className="small" style={{ color: 'var(--danger)' }}>
                            Only {item.availableStock} left — reduce the quantity to check out.
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{money(item.unitPriceCents)}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => run(() => setQuantity(item.productId, item.quantity - 1))}
                            disabled={busy}
                            aria-label={`Remove one ${item.name}`}
                          >
                            −
                          </button>
                          <span className="num" style={{ minWidth: 18 }}>
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => run(() => setQuantity(item.productId, item.quantity + 1))}
                            disabled={busy || item.quantity >= item.availableStock}
                            aria-label={`Add one ${item.name}`}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="num">{money(item.lineTotalCents)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-sm btn-danger"
                          onClick={() => run(() => setQuantity(item.productId, 0))}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="card card-pad sticky stack">
            <h2>Summary</h2>
            <div className="between">
              <span className="muted">
                Subtotal ({cart.itemCount} item{cart.itemCount === 1 ? '' : 's'})
              </span>
              <span className="num">{money(cart.subtotalCents)}</span>
            </div>
            <div className="between">
              <span className="muted">Delivery</span>
              <span className="num">Free</span>
            </div>
            <div
              className="between"
              style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}
            >
              <strong>Total</strong>
              <strong className="num" style={{ fontSize: '1.15rem' }}>
                {money(cart.totalCents)}
              </strong>
            </div>

            <button
              type="button"
              className="btn-primary btn-block"
              onClick={() => router.push('/checkout')}
              disabled={busy || items.some((item) => item.quantity > item.availableStock)}
            >
              Checkout
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              Starting checkout holds every item for five minutes so nobody can buy them out from
              under you while you pay.
            </p>
          </aside>
        </div>
      )}
    </main>
  );
}
