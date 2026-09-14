import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { env, isTest } from './config/env.js';
import { errorHandler, notFoundHandler, asyncHandler } from './lib/http.js';
import cartsRouter from './routes/carts.routes.js';
import ordersRouter from './routes/orders.routes.js';
import productsRouter from './routes/products.routes.js';
import {
  sweepExpiredReservations,
  sweepOnRequest,
  sweepStaleOrders,
} from './services/reservation.service.js';

/**
 * @param {object} [options]
 * @param {boolean} [options.sweepOnRequest] Run reservation expiry on incoming
 *   requests instead of on a timer. Required on serverless hosts, where the
 *   background interval never fires. Defaults on when Vercel is detected.
 */
export function createApp({ sweepOnRequest: sweepPerRequest = Boolean(process.env.VERCEL) } = {}) {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
      exposedHeaders: ['Idempotent-Replay'],
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  if (!isTest) app.use(morgan('tiny'));
  if (sweepPerRequest) app.use(sweepOnRequest());

  app.get('/', (req, res) =>
    res.json({
      service: 'Techloom Shop — Checkout & Payment API',
      docs: '/api/health',
      reservationTtlMinutes: env.reservationTtlMs / 60000,
    }),
  );

  app.get('/api/health', (req, res) =>
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), time: new Date() }),
  );

  app.use('/api/products', productsRouter);
  app.use('/api/carts', cartsRouter);
  app.use('/api/orders', ordersRouter);

  /**
   * Runs the expiry sweep on demand. The background sweeper already does this
   * on a timer; exposing it makes the 5-minute rule testable in seconds without
   * waiting on wall-clock time.
   */
  app.post(
    '/api/admin/sweep',
    asyncHandler(async (req, res) => {
      const expired = await sweepExpiredReservations();
      const closed = await sweepStaleOrders();
      res.json({ expiredReservations: expired, closedOrders: closed });
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
