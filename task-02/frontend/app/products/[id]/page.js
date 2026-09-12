'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { api, money } from '../../../lib/api.js';
import { useCart } from '../../../components/cart-context.js';
import { ProductImage } from '../../../components/product-image.js';
import { Notice, Spinner, StockMeter } from '../../../components/ui.js';

export default function ProductDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { add } = useCart();

  const [data, setData] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(false);

  const load = useCallback(async () => {
    const payload = await api(`/api/products/${id}`);
    setData(payload);
    return payload;
  }, [id]);

  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => load().catch(() => {}), 6000);
    return () => clearInterval(timer);
  }, [load]);

  async function addToCart(goToCart = false) {
    setBusy(true);
    setError('');
    setAdded(false);
    try {
      await add(id, quantity);
      await load();
      if (goToCart) router.push('/cart');
      else setAdded(true);
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
          <Spinner /> <span className="muted">Loading product…</span>
        </div>
      </main>
    );
  }

  const product = data?.product;
  if (!product) {
    return (
      <main className="page">
        <Notice tone="danger">{error || 'Product not found.'}</Notice>
        <Link className="btn" href="/" style={{ marginTop: 16 }}>
          Back to the shop
        </Link>
      </main>
    );
  }

  const soldOut = product.availableStock === 0;

  return (
    <main className="page">
      <p className="small muted" style={{ marginTop: 0 }}>
        <Link href="/">Shop</Link> / <span>{product.category}</span>
      </p>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>
      {added ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="ok" onDismiss={() => setAdded(false)}>
            Added to your cart.{' '}
            <Link href="/cart" style={{ textDecoration: 'underline' }}>
              Go to cart
            </Link>
          </Notice>
        </div>
      ) : null}

      <div className="hero">
        <ProductImage sku={product.sku} name={product.name} size="hero" />

        <div className="stack" style={{ gap: 16 }}>
          <div>
            <h1>{product.name}</h1>
            <p className="subtitle mono">{product.sku}</p>
          </div>

          <div className="price-lg">{money(product.priceCents)}</div>

          {product.description ? <p style={{ margin: 0 }}>{product.description}</p> : null}

          <div className="card card-pad stack">
            <StockMeter
              total={product.totalStock}
              reserved={product.reservedStock}
              available={product.availableStock}
            />
            {product.reservedStock > 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                {product.reservedStock} unit{product.reservedStock === 1 ? ' is' : 's are'} held in
                someone else&apos;s open checkout. Those free up automatically if they don&apos;t
                pay within five minutes.
              </p>
            ) : null}

            <div className="row">
              <div>
                <label htmlFor="qty">Quantity</label>
                <input
                  id="qty"
                  className="qty-input"
                  type="number"
                  min="1"
                  max={Math.max(1, product.availableStock)}
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(
                      Math.max(
                        1,
                        Math.min(Number(event.target.value) || 1, product.availableStock || 1),
                      ),
                    )
                  }
                  disabled={soldOut}
                />
              </div>
            </div>

            <div className="row">
              <button
                type="button"
                className="btn-primary"
                onClick={() => addToCart(false)}
                disabled={busy || soldOut}
              >
                {busy ? <Spinner /> : null}
                {soldOut ? 'Sold out' : 'Add to cart'}
              </button>
              <button type="button" onClick={() => addToCart(true)} disabled={busy || soldOut}>
                Buy it now
              </button>
            </div>
          </div>
        </div>
      </div>

      {data.related?.length ? (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ marginBottom: 14 }}>More in {product.category}</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {data.related.map((item) => (
              <Link key={item.id} href={`/products/${item.id}`} className="product-card">
                <ProductImage sku={item.sku} name={item.name} />
                <span style={{ fontWeight: 540 }}>{item.name}</span>
                <span className="tile-price">{money(item.priceCents)}</span>
                <span className="small muted">{item.availableStock} available</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
