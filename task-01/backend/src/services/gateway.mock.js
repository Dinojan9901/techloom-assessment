import crypto from 'node:crypto';

import { env } from '../config/env.js';
import { PAYMENT_OUTCOME } from '../models/Payment.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const REQUESTED = Object.freeze({
  AUTO: 'auto',
  SUCCESS: 'success',
  FAILURE: 'failure',
  TIMEOUT: 'timeout',
});

export const SIMULATABLE_OUTCOMES = Object.values(REQUESTED);

const DECLINE_REASONS = [
  'Card declined by issuer',
  'Insufficient funds',
  'Card reported lost or stolen',
  'Do not honour',
];

function pickWeighted(weights) {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [outcome, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return outcome;
  }
  return 'success';
}

/**
 * A stand-in for a real card gateway.
 *
 * Callers may force an outcome (`success` | `failure` | `timeout`) so every
 * branch is testable and demoable; left on `auto` it rolls against the weights
 * in config, the way an unpredictable third party would behave.
 */
export async function charge({ amountCents, requestedOutcome = REQUESTED.AUTO }) {
  const startedAt = Date.now();
  const resolved =
    requestedOutcome && requestedOutcome !== REQUESTED.AUTO
      ? requestedOutcome
      : pickWeighted(env.paymentOutcomeWeights);

  // Real gateways are never instant; a little latency makes the race conditions
  // this system guards against actually reachable in a demo.
  await sleep(resolved === REQUESTED.TIMEOUT ? env.paymentTimeoutMs : 120 + Math.random() * 180);

  const reference = `mock_${crypto.randomBytes(8).toString('hex')}`;
  const latencyMs = Date.now() - startedAt;

  if (resolved === REQUESTED.TIMEOUT) {
    return {
      outcome: PAYMENT_OUTCOME.TIMEOUT,
      reference,
      latencyMs,
      message: 'Gateway did not respond within the timeout window',
    };
  }

  if (resolved === REQUESTED.FAILURE) {
    return {
      outcome: PAYMENT_OUTCOME.FAILURE,
      reference,
      latencyMs,
      message: DECLINE_REASONS[Math.floor(Math.random() * DECLINE_REASONS.length)],
    };
  }

  return {
    outcome: PAYMENT_OUTCOME.SUCCESS,
    reference,
    latencyMs,
    message: `Approved for ${(amountCents / 100).toFixed(2)}`,
  };
}
