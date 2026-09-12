import mongoose from 'mongoose';

const { Schema } = mongoose;

export const IDEMPOTENCY_STATUS = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
});

/**
 * Client-supplied `Idempotency-Key` headers. Inserting the key is the lock: the
 * unique index means the first request wins, a retry of the same request replays
 * the stored response, and a *different* request reusing a key is rejected.
 */
const idempotencyKeySchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    scope: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(IDEMPOTENCY_STATUS),
      default: IDEMPOTENCY_STATUS.IN_PROGRESS,
    },
    responseStatus: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Stored keys are only useful for as long as a client might retry.
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyKey = mongoose.model('IdempotencyKey', idempotencyKeySchema);
