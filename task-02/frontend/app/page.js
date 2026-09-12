'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { api, money } from '../lib/api.js';
import { useCart } from '../components/cart-context.js';
import { ProductImage } from '../components/product-image.js';
import { Empty, Notice, Spinner, StockMeter } from '../components/ui.js';

const SORTS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name A–Z' },
];

const EMPTY_FILTERS = {
  search: '',
  category: '',
  minPrice: '',
  maxPrice: '',
  inStock: false,
  sort: 'relevance',
};

export default function StorefrontPage() {
  const { add } = useCart();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(null);

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (filters.category) params.set('category', filters.category);
    if (filters.minPrice) params.set('minPrice', filters.minPrice);
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
    if (filters.inStock) params.set('inStock', 'true');
    if (filters.sort) params.set('sort', filters.sort);
    return params.toString();
  }, [debouncedSearch, filters.category, filters.minPrice, filters.maxPrice, filters.inStock, filters.sort]);

  const load = useCallback(async () => {
    const payload = await api(`/api/products?${query}`);
    setData(payload);
  }, [query]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [load]);

  /**
   * Availability changes when other shoppers start a checkout, so the grid
   * refreshes quietly. Without this, a product could look in stock right up
   * until the moment checkout refuses it.
   */
  useEffect(() => {
    const timer = setInterval(() => load().catch(() => {}), 6000);
    return () => clearInterval(timer);
  }, [load]);

  async function addToCart(product) {
    setAdding(product.id);
    setError('');
    try {
      await add(product.id, 1);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(null);
    }
  }

  const products = data?.products ?? [];
  const hasFilters =
    filters.search || filters.category || filters.minPrice || filters.maxPrice || filters.inStock;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Everything for the desk</h1>
          <p className="subtitle">
            {data ? `${data.total} product${data.total === 1 ? '' : 's'}` : 'Loading catalogue…'}
            {' · stock shown here is what is genuinely free to buy right now'}
          </p>
        </div>
        <select
          value={filters.sort}
          onChange={(event) => setFilters({ ...filters, sort: event.target.value })}
          aria-label="Sort products"
          style={{ width: 'auto' }}
        >
          {SORTS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <Notice tone="danger" onDismiss={() => setError('')}>
        {error}
      </Notice>

      <div className="split" style={{ marginTop: 16, gridTemplateColumns: '260px 1fr' }}>
        <aside className="card card-pad sticky filters">
          <div className="filter-group">
            <label htmlFor="search">Search</label>
            <input
              id="search"
              type="search"
              placeholder="Keyboard, monitor, SKU…"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </div>

          <div className="filter-group">
            <label>Category</label>
            <div className="chip-row">
              <button
                type="button"
                className="chip"
                data-active={filters.category === ''}
                onClick={() => setFilters({ ...filters, category: '' })}
              >
                All
              </button>
              {(data?.categories ?? []).map((category) => (
                <button
                  key={category}
                  type="button"
                  className="chip"
                  data-active={filters.category === category}
                  onClick={() => setFilters({ ...filters, category })}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label>Price range (LKR)</label>
            <div className="row">
              <input
                type="number"
                min="0"
                placeholder={
                  data ? String(Math.floor((data.priceRange.minCents ?? 0) / 100)) : 'Min'
                }
                value={filters.minPrice}
                onChange={(event) => setFilters({ ...filters, minPrice: event.target.value })}
                aria-label="Minimum price"
              />
              <span className="muted">–</span>
              <input
                type="number"
                min="0"
                placeholder={
                  data ? String(Math.ceil((data.priceRange.maxCents ?? 0) / 100)) : 'Max'
                }
                value={filters.maxPrice}
                onChange={(event) => setFilters({ ...filters, maxPrice: event.target.value })}
                aria-label="Maximum price"
              />
            </div>
          </div>

          <label className="row small" style={{ margin: 0, gap: 8 }}>
            <input
              type="checkbox"
              checked={filters.inStock}
              onChange={(event) => setFilters({ ...filters, inStock: event.target.checked })}
              style={{ width: 'auto' }}
            />
            In stock only
          </label>

          {hasFilters ? (
            <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </button>
          ) : null}
        </aside>

        <section>
          {loading ? (
            <div className="card">
              <Empty>
                <Spinner /> Searching the catalogue…
              </Empty>
            </div>
          ) : products.length === 0 ? (
            <div className="card">
              <Empty>
                Nothing matches those filters.
                {hasFilters ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => setFilters(EMPTY_FILTERS)}
                    >
                      Clear them
                    </button>
                  </>
                ) : null}
              </Empty>
            </div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
              {products.map((product) => (
                <article key={product.id} className="product-card">
                  <Link href={`/products/${product.id}`}>
                    <ProductImage sku={product.sku} name={product.name} />
                  </Link>

                  <div className="stack" style={{ gap: 4, flex: 1 }}>
                    <Link href={`/products/${product.id}`} style={{ fontWeight: 560 }}>
                      {product.name}
                    </Link>
                    <span className="small muted">{product.category}</span>
                    <span className="tile-price">{money(product.priceCents)}</span>
                  </div>

                  <StockMeter
                    total={product.totalStock}
                    reserved={product.reservedStock}
                    available={product.availableStock}
                  />

                  <button
                    type="button"
                    className="btn-primary btn-block"
                    onClick={() => addToCart(product)}
                    disabled={adding === product.id || product.availableStock === 0}
                  >
                    {adding === product.id ? <Spinner /> : null}
                    {product.availableStock === 0 ? 'Sold out' : 'Add to cart'}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
