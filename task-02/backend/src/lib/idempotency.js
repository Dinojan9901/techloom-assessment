import crypto from 'node:crypto';

import { DuplicateRequestError, ValidationError } from './errors.js';
import { asyncHandler } from './http.js';
import { IdempotencyKey, IDEMPOTENCY_STATUS } from '../models/IdempotencyKey.js';

const RETENTION_MS = 24 * 60 * 60 * 1000;

const hash = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

/**
 * Makes a POST route safe to retry.
 *
 * Inserting the key *is* the lock — the unique index means the first request
 * through wins. A retry carrying the same key and body replays the original
 * response verbatim; the same key with a different body is a client bug and is
 * rejected rather than quietly doing something new.
 */
export const idempotent = (scope) =>
  asyncHandler(async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key) return next();

    const requestHash = hash({ path: req.baseUrl + req.path, body: req.body ?? {} });

    try {
      await IdempotencyKey.create({
        key,
        scope,
        requestHash,
        expiresAt: new Date(Date.now() + RETENTION_MS),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;

      const existing = await IdempotencyKey.findOne({ key });

      if (existing && existing.requestHash !== requestHash) {
        throw new ValidationError(
          'This Idempotency-Key was already used for a different request',
          [{ field: 'Idempotency-Key', message: 'Key reuse with a different payload' }],
        );
      }

      if (existing?.status === IDEMPOTENCY_STATUS.COMPLETED) {
        return res
          .status(existing.responseStatus ?? 200)
          .set('Idempotent-Replay', 'true')
          .json(existing.responseBody);
      }

      throw new DuplicateRequestError('An identical request is still being processed', {
        idempotencyKey: key,
      });
    }

    // Record whatever this request ends up returning, so the retry can replay it.
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      IdempotencyKey.updateOne(
        { key },
        {
          $set: {
            status: IDEMPOTENCY_STATUS.COMPLETED,
            responseStatus: res.statusCode,
            // Serialise through JSON so stored bodies match what the client
            // originally received (Mongoose documents apply their toJSON).
            responseBody: JSON.parse(JSON.stringify(body)),
          },
        },
      ).catch((error) => console.error('[idempotency] failed to store response', error));
      return sendJson(body);
    };

    return next();
  });
