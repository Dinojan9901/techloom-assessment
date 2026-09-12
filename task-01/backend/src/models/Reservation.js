import mongoose from 'mongoose';

const { Schema } = mongoose;

export const RESERVATION_STATUS = Object.freeze({
  /** Stock is held; `expiresAt` is in the future. */
  ACTIVE: 'ACTIVE',
  /** Stock was handed back to available inventory (expiry, failure, cancel). */
  RELEASED: 'RELEASED',
  /** The sale settled: held stock was converted into sold stock. */
  COMMITTED: 'COMMITTED',
});

const reservedItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const reservationSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    items: { type: [reservedItemSchema], required: true },
    status: {
      type: String,
      enum: Object.values(RESERVATION_STATUS),
      default: RESERVATION_STATUS.ACTIVE,
    },
    expiresAt: { type: Date, required: true },
    settledAt: { type: Date, default: null },
    releaseReason: { type: String, default: '' },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

/**
 * The sweeper's query. Deliberately *not* a TTL index: an expiring reservation
 * has to give its stock back, which means running logic, not deleting a row.
 */
reservationSchema.index({ status: 1, expiresAt: 1 });

reservationSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Reservation = mongoose.model('Reservation', reservationSchema);
