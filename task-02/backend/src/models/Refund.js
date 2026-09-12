import mongoose from 'mongoose';

const { Schema } = mongoose;

export const REFUND_STATUS = Object.freeze({
  /** The mock gateway acknowledged and settled the reversal. */
  SETTLED: 'SETTLED',
  /** The reversal could not be placed (no captured payment to reverse). */
  REJECTED: 'REJECTED',
});

export const REFUND_REASON = Object.freeze({
  CUSTOMER_CANCELLED: 'CUSTOMER_CANCELLED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  MERCHANT_CANCELLED: 'MERCHANT_CANCELLED',
});

const refundSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    amountCents: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.SETTLED,
    },
    reason: {
      type: String,
      enum: Object.values(REFUND_REASON),
      default: REFUND_REASON.CUSTOMER_CANCELLED,
    },
    note: { type: String, default: '' },
    gatewayReference: { type: String, required: true, unique: true },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

refundSchema.index({ order: 1, createdAt: -1 });

/**
 * One settled refund per order. A second cancellation of an already-refunded
 * order is stopped by the order's state machine first; this index is the
 * database-level guarantee behind it.
 */
refundSchema.index(
  { order: 1 },
  { unique: true, partialFilterExpression: { status: REFUND_STATUS.SETTLED } },
);

refundSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Refund = mongoose.model('Refund', refundSchema);
