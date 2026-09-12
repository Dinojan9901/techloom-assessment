import dotenv from 'dotenv';

dotenv.config();

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 4002),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/techloom_shop',

  /** How long stock stays reserved once a checkout starts. Spec: 5 minutes. */
  reservationTtlMs: int(process.env.RESERVATION_TTL_MINUTES, 5) * 60 * 1000,

  /** How often the background sweeper looks for expired reservations. */
  sweeperIntervalMs: int(process.env.SWEEPER_INTERVAL_MS, 15_000),

  /** Simulated gateway latency for the `timeout` outcome, in ms. */
  paymentTimeoutMs: int(process.env.PAYMENT_TIMEOUT_MS, 1_500),

  /** Weights used when a payment is requested without an explicit outcome. */
  paymentOutcomeWeights: {
    success: int(process.env.PAYMENT_WEIGHT_SUCCESS, 70),
    failure: int(process.env.PAYMENT_WEIGHT_FAILURE, 20),
    timeout: int(process.env.PAYMENT_WEIGHT_TIMEOUT, 10),
  },

  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export const isTest = env.nodeEnv === 'test';
