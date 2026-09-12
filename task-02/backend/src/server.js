import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { createApp } from './app.js';
import {
  startReservationSweeper,
  stopReservationSweeper,
} from './services/reservation.service.js';

const connection = await connectDb();
console.log(`[db] connected to ${connection.name}`);

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`[api] listening on :${env.port} (${env.nodeEnv})`);
});

startReservationSweeper();
console.log(
  `[sweeper] running every ${env.sweeperIntervalMs}ms; reservations last ${env.reservationTtlMs / 60000} minute(s)`,
);

const shutdown = (signal) => {
  console.log(`[api] ${signal} received, shutting down`);
  stopReservationSweeper();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
