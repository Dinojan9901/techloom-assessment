import mongoose from 'mongoose';

import { env } from './env.js';

let transactionsSupported = null;

export async function connectDb(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  transactionsSupported = null;
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.connection.close();
}

/**
 * Multi-document transactions need a replica set. Atlas (even the free M0 tier)
 * is always a replica set, so production gets real transactions; a bare local
 * `mongod` does not, and there we fall back to per-document atomic updates plus
 * compensating rollback. Detected once, then cached.
 */
export function supportsTransactions() {
  if (transactionsSupported !== null) return transactionsSupported;
  const topology = mongoose.connection.client?.topology;
  const description = topology?.description;
  transactionsSupported =
    description?.type === 'ReplicaSetWithPrimary' || description?.type === 'Sharded';
  return transactionsSupported;
}
