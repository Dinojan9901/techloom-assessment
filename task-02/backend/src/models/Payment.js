import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PAYMENT_OUTCOME = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  TIMEOUT: 'TIMEOUT',
});

const paymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    amountCents: { type: Number, required: true, min: 0 },
    outcome: { type: String, enum: Object.values(PAYMENT_OUTCOME), required: true },
    gatewayReference: { type: String, required: true, unique: true },
    /** Echoes what the caller asked the mock gateway to simulate, if anything. */
    requestedOutcome: { type: String, default: 'auto' },
    message: { type: String, default: '' },
    latencyMs: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

/**
 * At most one *successful* charge per order, enforced by the database rather
 * than by application logic — the last line of defence against double billing.
 */
// Attempt history for an order, newest first.
paymentSchema.index({ order: 1, createdAt: -1 });

paymentSchema.index(
  { order: 1 },
  { unique: true, partialFilterExpression: { outcome: PAYMENT_OUTCOME.SUCCESS } },
);

paymentSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Payment = mongoose.model('Payment', paymentSchema);
