import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Stock is modelled as two counters rather than one:
 *
 *   totalStock    units physically on the shelf (only changes when a sale settles)
 *   reservedStock units currently held by an in-flight checkout
 *   available     = totalStock - reservedStock, what a new shopper may take
 *
 * Keeping them separate means a reservation never has to be "undone" against a
 * moving target, and `available` can never be driven below zero by a conditional
 * update that checks it.
 */
const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    category: { type: String, trim: true, default: 'general', index: true },
    imageUrl: { type: String, trim: true, default: '' },

    /** Money is stored in minor units (cents) so arithmetic stays exact. */
    priceCents: { type: Number, required: true, min: 0 },

    totalStock: { type: Number, required: true, min: 0, default: 0 },
    reservedStock: { type: Number, required: true, min: 0, default: 0 },

    isActive: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

productSchema.virtual('availableStock').get(function availableStock() {
  return Math.max(0, this.totalStock - this.reservedStock);
});

productSchema.virtual('price').get(function price() {
  return this.priceCents / 100;
});

productSchema.index({ name: 'text', description: 'text', sku: 'text' });

productSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Product = mongoose.model('Product', productSchema);
