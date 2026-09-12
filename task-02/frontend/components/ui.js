'use client';

import { useEffect, useState } from 'react';

const STATUS_TONES = {
  PENDING: 'neutral',
  RESERVED: 'warn',
  PROCESSING: 'accent',
  PAID: 'ok',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  REFUNDED: 'accent',
};

export function StatusBadge({ status }) {
  return (
    <span className="badge" data-tone={STATUS_TONES[status] ?? 'neutral'}>
      {status}
    </span>
  );
}

/**
 * Splits a product's stock into sold-through, currently held, and free.
 * Seeing the held segment move is the whole point: it is what proves a
 * reservation is a real thing and not just a number on an order.
 */
export function StockMeter({ total, reserved, available }) {
  const capacity = Math.max(total, 1);
  const heldPct = Math.round((reserved / capacity) * 100);
  const freePct = Math.round((available / capacity) * 100);

  return (
    <div className="stack" style={{ gap: 5 }}>
      <div className="meter" aria-hidden="true">
        <span className="sold" style={{ width: `${freePct}%` }} />
        <span className="held" style={{ width: `${heldPct}%` }} />
      </div>
      <div className="small muted">
        {available} available
        {reserved > 0 ? ` · ${reserved} held in checkout` : ''}
      </div>
    </div>
  );
}

/**
 * Live countdown on a reservation window. Ticks locally for smoothness but
 * takes the server's expiry instant as the source of truth, so a clock skew
 * cannot make the UI claim more time than the backend will honour.
 */
export function Countdown({ expiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(() => msLeft(expiresAt));

  useEffect(() => {
    setRemaining(msLeft(expiresAt));
    if (!expiresAt) return undefined;

    const timer = setInterval(() => {
      const next = msLeft(expiresAt);
      setRemaining(next);
      if (next <= 0) {
        clearInterval(timer);
        onExpire?.();
      }
    }, 250);

    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  if (!expiresAt) return null;

  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const urgent = seconds <= 30;

  return (
    <span className="countdown" style={{ color: urgent ? 'var(--danger)' : 'inherit' }}>
      {String(Math.floor(seconds / 60)).padStart(2, '0')}:
      {String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

function msLeft(expiresAt) {
  if (!expiresAt) return 0;
  return new Date(expiresAt).getTime() - Date.now();
}

export function Notice({ tone = 'neutral', children, onDismiss }) {
  if (!children) return null;
  return (
    <div className="notice" data-tone={tone}>
      <div style={{ flex: 1 }}>{children}</div>
      {onDismiss ? (
        <button type="button" className="btn-sm" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}
