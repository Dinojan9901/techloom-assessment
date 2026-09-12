'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '../lib/api.js';

const CartContext = createContext(null);

/**
 * One copy of the cart, shared by the header badge, the product pages and the
 * cart screen. Every mutation returns the server's cart, so the badge can never
 * drift from what checkout will actually reserve.
 */
export function CartProvider({ children }) {
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const data = await api('/api/carts/current');
    setCart(data.cart);
    return data.cart;
  }, []);

  useEffect(() => {
    refresh()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [refresh]);

  const add = useCallback(async (productId, quantity = 1) => {
    const data = await api('/api/carts/current/items', {
      method: 'POST',
      body: { productId, quantity },
    });
    setCart(data.cart);
    return data.cart;
  }, []);

  const setQuantity = useCallback(async (productId, quantity) => {
    const data = await api(`/api/carts/current/items/${productId}`, {
      method: 'PATCH',
      body: { quantity },
    });
    setCart(data.cart);
    return data.cart;
  }, []);

  const clear = useCallback(async () => {
    const data = await api('/api/carts/current', { method: 'DELETE' });
    setCart(data.cart);
    return data.cart;
  }, []);

  const value = useMemo(
    () => ({ cart, loading, error, refresh, add, setQuantity, clear, setError }),
    [cart, loading, error, refresh, add, setQuantity, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside a CartProvider');
  return context;
}
