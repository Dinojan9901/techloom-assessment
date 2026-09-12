'use client';

import { useCallback, useEffect, useState } from 'react';

import { api, money } from '../../lib/api.js';
import { Empty, Notice, Spinner, StockMeter } from '../../components/ui.js';

const BLANK = {
  name: '',
  sku: '',
  category: 'general',
  description: '',
  price: '',
  totalStock: '',
};

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(async () => {
    const data = await api('/api/products?includeInactive=true&limit=200');
    setProducts(data.products);
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [load]);

  function startEdit(product) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      sku: product.sku,
      category: product.category,
      description: product.description ?? '',
      price: (product.priceCents / 100).toFixed(2),
      totalStock: String(product.totalStock),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(BLANK);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim().toUpperCase(),
        category: form.category.trim() || 'general',
        description: form.description.trim(),
        priceCents: Math.round(Number(form.price) * 100),
        totalStock: Number(form.totalStock),
      };

      if (!Number.isFinite(payload.priceCents) || !Number.isFinite(payload.totalStock)) {
        throw new Error('Price and stock must be numbers');
      }

      if (editingId) {
        await api(`/api/products/${editingId}`, { method: 'PATCH', body: payload });
      } else {
        await api('/api/products', { method: 'POST', body: payload });
      }

      cancelEdit();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(product) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/products/${product.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function restock(product, delta) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/products/${product.id}`, {
        method: 'PATCH',
        body: { totalStock: Math.max(0, product.totalStock + delta) },
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p className="subtitle">
            Stock on the shelf, and how much of it is currently held by an open checkout. Restocking
            changes the shelf only — held units stay held.
          </p>
        </div>
      </div>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>

      <div className="split" style={{ marginTop: 16 }}>
        <section className="card">
          {loading ? (
            <Empty>
              <Spinner /> Loading inventory…
            </Empty>
          ) : products.length === 0 ? (
            <Empty>No products yet. Add your first one on the right.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Price</th>
                    <th style={{ minWidth: 180 }}>Stock</th>
                    <th className="num">Shelf</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} style={{ opacity: product.isActive ? 1 : 0.5 }}>
                      <td>
                        <div style={{ fontWeight: 540 }}>{product.name}</div>
                        <div className="small muted mono">
                          {product.sku} · {product.category}
                          {product.isActive ? '' : ' · inactive'}
                        </div>
                      </td>
                      <td className="num">{money(product.priceCents)}</td>
                      <td>
                        <StockMeter
                          total={product.totalStock}
                          reserved={product.reservedStock}
                          available={product.availableStock}
                        />
                      </td>
                      <td className="num">{product.totalStock}</td>
                      <td>
                        <div className="row" style={{ gap: 5, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => restock(product, -1)}
                            disabled={busy || product.totalStock === 0}
                            aria-label={`Reduce ${product.name} stock`}
                          >
                            −
                          </button>
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => restock(product, 1)}
                            disabled={busy}
                            aria-label={`Add ${product.name} stock`}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="btn-sm"
                            onClick={() => startEdit(product)}
                            disabled={busy}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-sm btn-danger"
                            onClick={() => remove(product)}
                            disabled={busy || !product.isActive}
                          >
                            Retire
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="card card-pad sticky">
          <h2 style={{ marginBottom: 14 }}>{editingId ? 'Edit product' : 'Add a product'}</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="sku">SKU</label>
                <input
                  id="sku"
                  required
                  value={form.sku}
                  onChange={(event) => setForm({ ...form, sku: event.target.value })}
                  placeholder="BEV-FW-01"
                />
              </div>
              <div className="field">
                <label htmlFor="category">Category</label>
                <input
                  id="category"
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="price">Price (LKR)</label>
                <input
                  id="price"
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(event) => setForm({ ...form, price: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="stock">Stock on shelf</label>
                <input
                  id="stock"
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={form.totalStock}
                  onChange={(event) => setForm({ ...form, totalStock: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>

            <div className="row">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? <Spinner /> : null}
                {editingId ? 'Save changes' : 'Add product'}
              </button>
              {editingId ? (
                <button type="button" onClick={cancelEdit} disabled={busy}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </aside>
      </div>
    </main>
  );
}
