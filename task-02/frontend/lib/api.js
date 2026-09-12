const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4002').replace(/\/$/, '');

const SESSION_STORAGE_KEY = 'techloom.shop.sessionId';

/**
 * The storefront has no sign-in, so each browser gets one stable shopper id.
 * The backend scopes carts and order history to it, which is what makes "my
 * orders" mean something without building an auth system the brief never asked
 * for.
 */
export function getSessionId() {
  if (typeof window === 'undefined') return 'server';

  let id = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!id) {
    id = `shopper-${crypto.randomUUID()}`;
    window.localStorage.setItem(SESSION_STORAGE_KEY, id);
  }
  return id;
}

export function resetSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(message, { status, code, details, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.body = body;
  }
}

/**
 * Thin fetch wrapper.
 *
 * Declines (402) and gateway timeouts (504) carry a full body the UI needs, so
 * they resolve like a success and the caller branches on `outcome`. Everything
 * else that is not 2xx becomes an ApiError.
 */
export async function api(path, { method = 'GET', body, idempotencyKey, raw = false } = {}) {
  const headers = { 'X-Session-Id': getSessionId() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));

  if (raw || response.ok) return payload;

  // A declined or timed-out payment is a business outcome, not a failure of the
  // request; the caller wants the order it produced.
  if (payload?.outcome) return payload;

  throw new ApiError(payload?.error?.message ?? `Request failed (${response.status})`, {
    status: response.status,
    code: payload?.error?.code,
    details: payload?.error?.details,
    body: payload,
  });
}

export const money = (cents) =>
  new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(
    (cents ?? 0) / 100,
  );

export const newIdempotencyKey = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(16).slice(2)}`;
