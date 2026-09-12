'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { api, money, newIdempotencyKey } from '../lib/api.js';
import { Empty, Notice, Spinner, StockMeter } from '../components/ui.js';

export default function RegisterPage() {
  const router = useRouter();

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [customer, setCustomer] = useState({ name: '', email: '' });

  const loadProducts = useCallback(async () => {
    const params = new URLSearchParams({ inStock: 'false' });
    if (search) params.set('search', search);
    if (category) params.set('category', category);

    const data = await api(`/api/products?${params}`);
    setProducts(data.products);
    setCategories(data.categories);
  }, [search, category]);

  const loadCart = useCallback(async () => {
    const data = await api('/api/carts/current');
    setCart(data.cart);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await Promise.all([loadProducts(), loadCart()]);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadProducts, loadCart]);

  /**
   * Stock moves because of *other* terminals, not just this one, so the grid
   * refreshes on a timer. It is the cheapest honest way to show that a
   * reservation elsewhere reduces what this till can sell.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      loadProducts().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [loadProducts]);

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

  const addToCart = (product) =>
    run(async () => {
      const data = await api('/api/carts/current/items', {
        method: 'POST',
        body: { productId: product.id, quantity: 1 },
      });
      setCart(data.cart);
      await loadProducts();
    });

  const setQuantity = (productId, quantity) =>
    run(async () => {
      const data = await api(`/api/carts/current/items/${productId}`, {
        method: 'PATCH',
        body: { quantity },
      });
      setCart(data.cart);
    });

  const clearCart = () =>
    run(async () => {
      const data = await api('/api/carts/current', { method: 'DELETE' });
      setCart(data.cart);
    });

  const checkout = () =>
    run(async () => {
      const data = await api('/api/orders/checkout', {
        method: 'POST',
        // A key makes a double-clicked Checkout button produce one order, even
        // if the first response is still in flight.
        idempotencyKey: newIdempotencyKey(),
        body: {
          cartId: cart.id,
          customer: { name: customer.name, email: customer.email },
        },
      });
      router.push(`/orders/${data.order.id}`);
    });

  if (loading) {
    return (
      <main className="page">
        <div className="row">
          <Spinner /> <span className="muted">Loading the register…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Register</h1>
          <p className="subtitle">
            Availability is live. Units held by another terminal&apos;s open checkout are shown in
            amber and cannot be sold twice.
          </p>
        </div>
      </div>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>

      <div className="split" style={{ marginTop: error ? 16 : 0 }}>
        <section>
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search by name or SKU…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search products"
            />
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {products.length === 0 ? (
            <div className="card">
              <Empty>No products match. Add some in Inventory, or clear the filters.</Empty>
            </div>
          ) : (
            <div className="grid">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="tile"
                  onClick={() => addToCart(product)}
                  disabled={busy || product.availableStock === 0}
                >
                  <span className="tile-name">{product.name}</span>
                  <span className="small muted mono">{product.sku}</span>
                  <span className="tile-price">{money(product.priceCents)}</span>
                  <StockMeter
                    total={product.totalStock}
                    reserved={product.reservedStock}
                    available={product.availableStock}
                  />
                  {product.availableStock === 0 ? (
                    <span className="badge" data-tone="danger">
                      Sold out
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="card card-pad sticky stack">
          <div className="between">
            <h2>Current sale</h2>
            {cart?.items.length ? (
              <button type="button" className="btn-sm" onClick={clearCart} disabled={busy}>
                Clear
              </button>
            ) : null}
          </div>

          {!cart?.items.length ? (
            <Empty>Tap a product to start a sale.</Empty>
          ) : (
            <>
              <div className="stack">
                {cart.items.map((item) => (
                  <div key={item.productId} className="between">
                    <div>
                      <div style={{ fontWeight: 540 }}>{item.name}</div>
                      <div className="small muted">
                        {money(item.unitPriceCents)} each · {item.availableStock} left
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => setQuantity(item.productId, item.quantity - 1)}
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
                        onClick={() => setQuantity(item.productId, item.quantity + 1)}
                        disabled={busy || item.quantity >= item.availableStock}
                        aria-label={`Add one ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="between" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <strong>Total</strong>
                <strong className="num" style={{ fontSize: '1.15rem' }}>
                  {money(cart.totalCents)}
                </strong>
              </div>

              <div className="field-row">
                <div>
                  <label htmlFor="customer-name">Customer (optional)</label>
                  <input
                    id="customer-name"
                    value={customer.name}
                    onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                    placeholder="Walk-in customer"
                  />
                </div>
                <div>
                  <label htmlFor="customer-email">Email (optional)</label>
                  <input
                    id="customer-email"
                    type="email"
                    value={customer.email}
                    onChange={(event) => setCustomer({ ...customer, email: event.target.value })}
                    placeholder="name@example.com"
                  />
                </div>
              </div>

              <button
                type="button"
                className="btn-primary btn-block"
                onClick={checkout}
                disabled={busy}
              >
                {busy ? <Spinner /> : null}
                Checkout &amp; hold stock for 5 min
              </button>
              <p className="small muted" style={{ margin: 0 }}>
                Checking out reserves every line immediately. If any line is short, nothing is
                held and the sale stays open.
              </p>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
