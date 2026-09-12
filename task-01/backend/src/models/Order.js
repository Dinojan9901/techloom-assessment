import mongoose from 'mongoose';

import { ORDER_STATUS } from '../lib/order-status.js';

const { Schema } = mongoose;

/** Line items snapshot name and price so history survives later product edits. */
const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    unitPriceCents: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const statusEventSchema = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    reason: { type: String, default: '' },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    cart: { type: Schema.Types.ObjectId, ref: 'Cart', required: true },
    sessionId: { type: String, required: true, index: true },
    customer: {
      name: { type: String, default: 'Walk-in customer' },
      email: { type: String, default: '' },
    },

    items: { type: [orderItemSchema], required: true },
    subtotalCents: { type: Number, required: true, min: 0 },
    totalCents: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
      index: true,
    },
    statusHistory: { type: [statusEventSchema], default: [] },

    reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', default: null },
    /** Denormalised from the reservation so clients can render a countdown. */
    reservedUntil: { type: Date, default: null },

    payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    failureReason: { type: String, default: '' },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

orderSchema.index({ status: 1, reservedUntil: 1 });

orderSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Order = mongoose.model('Order', orderSchema);
