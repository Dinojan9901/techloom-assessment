import { connectDb, disconnectDb } from '../config/db.js';
import { Cart } from '../models/Cart.js';
import { IdempotencyKey } from '../models/IdempotencyKey.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { Product } from '../models/Product.js';
import { Reservation } from '../models/Reservation.js';

/**
 * Deliberately includes a few very-low-stock lines: those are the ones worth
 * hammering when demonstrating that concurrent checkouts cannot oversell.
 */
const PRODUCTS = [
  { name: 'Flat White', sku: 'BEV-FW-01', category: 'beverages', priceCents: 45000, totalStock: 40 },
  { name: 'Cold Brew 500ml', sku: 'BEV-CB-02', category: 'beverages', priceCents: 62000, totalStock: 25 },
  { name: 'Masala Chai', sku: 'BEV-MC-03', category: 'beverages', priceCents: 38000, totalStock: 60 },
  { name: 'Butter Croissant', sku: 'BAK-CR-01', category: 'bakery', priceCents: 55000, totalStock: 18 },
  { name: 'Chocolate Brownie', sku: 'BAK-BR-02', category: 'bakery', priceCents: 48000, totalStock: 12 },
  { name: 'Sourdough Loaf', sku: 'BAK-SL-03', category: 'bakery', priceCents: 92000, totalStock: 8 },
  { name: 'Chicken Kottu', sku: 'MEA-CK-01', category: 'meals', priceCents: 125000, totalStock: 15 },
  { name: 'Veg Fried Rice', sku: 'MEA-VR-02', category: 'meals', priceCents: 98000, totalStock: 20 },
  { name: 'Limited Edition Mug', sku: 'MRC-MG-01', category: 'merch', priceCents: 185000, totalStock: 3 },
  { name: 'Signature Tote Bag', sku: 'MRC-TB-02', category: 'merch', priceCents: 240000, totalStock: 5 },
  { name: 'Single Origin Beans 250g', sku: 'MRC-CB-03', category: 'merch', priceCents: 320000, totalStock: 10 },
  { name: 'Barista Keep Cup', sku: 'MRC-KC-04', category: 'merch', priceCents: 275000, totalStock: 1 },
];

const descriptions = {
  beverages: 'Made to order at the bar.',
  bakery: 'Baked fresh this morning.',
  meals: 'Served hot from the kitchen.',
  merch: 'Take a little of the shop home with you.',
};

async function seed() {
  await connectDb();

  await Promise.all([
    Product.deleteMany({}),
    Cart.deleteMany({}),
    Order.deleteMany({}),
    Reservation.deleteMany({}),
    Payment.deleteMany({}),
    IdempotencyKey.deleteMany({}),
  ]);

  const created = await Product.insertMany(
    PRODUCTS.map((product) => ({
      ...product,
      description: descriptions[product.category] ?? '',
      reservedStock: 0,
      isActive: true,
    })),
  );

  console.log(`Seeded ${created.length} products; all carts, orders and payments cleared.`);
  console.table(
    created.map(({ sku, name, priceCents, totalStock }) => ({
      sku,
      name,
      price: `LKR ${(priceCents / 100).toFixed(2)}`,
      stock: totalStock,
    })),
  );

  await disconnectDb();
}

seed().catch(async (error) => {
  console.error(error);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
