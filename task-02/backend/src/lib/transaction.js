import mongoose from 'mongoose';

import { supportsTransactions } from '../config/db.js';

const TRANSIENT_LABELS = ['TransientTransactionError', 'UnknownTransactionCommitResult'];

const isTransient = (error) =>
  Array.isArray(error?.errorLabels) &&
  error.errorLabels.some((label) => TRANSIENT_LABELS.includes(label));

/**
 * Runs `fn` inside a transaction when the deployment supports one, retrying on
 * write conflicts — which is exactly what two shoppers racing for the last unit
 * of a product produce. Falls back to running without a session on a standalone
 * mongod; callers are written so that path is still safe (atomic per-document
 * updates plus compensating rollback).
 *
 * @param {(session: import('mongoose').ClientSession | null) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withTransaction(fn, { maxRetries = 5 } = {}) {
  if (!supportsTransactions()) {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        let result;
        await session.withTransaction(async () => {
          result = await fn(session);
        });
        return result;
      } catch (error) {
        if (isTransient(error) && attempt < maxRetries) {
          // Exponential-ish backoff keeps a hot product from live-locking.
          await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
  } finally {
    await session.endSession();
  }
}
