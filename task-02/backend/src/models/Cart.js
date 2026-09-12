import mongoose from 'mongoose';

const { Schema } = mongoose;

export const CART_STATUS = Object.freeze({
  OPEN: 'OPEN',
  CHECKED_OUT: 'CHECKED_OUT',
  ABANDONED: 'ABANDONED',
});

const cartItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const cartSchema = new Schema(
  {
    /** Anonymous POS terminals/browsers are identified by an opaque client id. */
    sessionId: { type: String, required: true, index: true },
    items: { type: [cartItemSchema], default: [] },
    status: {
      type: String,
      enum: Object.values(CART_STATUS),
      default: CART_STATUS.OPEN,
      index: true,
    },
    /** Set when the cart becomes an order, so a cart can never check out twice. */
    checkedOutOrder: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

cartSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Cart = mongoose.model('Cart', cartSchema);
