import express from 'express';

import { createApp } from '../src/app.js';
import { connectDb } from '../src/config/db.js';

/**
 * Serverless entry point (Vercel).
 *
 * `src/server.js` is still the entry point for running locally or on any
 * always-on host; this file is the same application wrapped for a platform that
 * invokes it per request.
 *
 * Two things change on serverless:
 *
 *  1. The database connection is opened once per warm instance and reused.
 *     Connecting per request would exhaust the Atlas connection limit quickly.
 *  2. Reservation expiry runs on incoming requests rather than on a timer,
 *     because a frozen function's `setInterval` never fires. `createApp`
 *     switches that on automatically when it detects Vercel.
 */
let connecting = null;

function ensureDb() {
  if (!connecting) {
    connecting = connectDb().catch((error) => {
      // Let the next invocation try again rather than caching a failure.
      connecting = null;
      throw error;
    });
  }
  return connecting;
}

const api = createApp();
const handler = express();

handler.use(async (req, res, next) => {
  try {
    await ensureDb();
    next();
  } catch (error) {
    next(error);
  }
});

handler.use(api);

export default handler;
