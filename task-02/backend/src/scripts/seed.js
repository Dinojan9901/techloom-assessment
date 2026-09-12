import { connectDb, disconnectDb } from '../config/db.js';
import { Cart } from '../models/Cart.js';
import { IdempotencyKey } from '../models/IdempotencyKey.js';
import { Order } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { Product } from '../models/Product.js';
import { Refund } from '../models/Refund.js';
import { Reservation } from '../models/Reservation.js';

/**
 * A storefront catalogue wide enough for search and filtering to be worth
 * trying, with a few deliberately scarce lines so reservation and overselling
 * behaviour is easy to demonstrate.
 */
const PRODUCTS = [
  ['Aurora Mechanical Keyboard', 'KB-AUR-75', 'keyboards', 4850000, 12, 'Hot-swappable 75% board with gasket mounting and a milled aluminium case.'],
  ['Aurora Keyboard — Tactile', 'KB-AUR-TC', 'keyboards', 5250000, 6, 'The Aurora with pre-lubed tactile switches and a brass weight.'],
  ['Halo Low-Profile Keyboard', 'KB-HLO-60', 'keyboards', 3950000, 20, 'A 60% low-profile board that disappears into a travel bag.'],
  ['Drift Wireless Mouse', 'MS-DRF-01', 'mice', 2250000, 30, 'Lightweight 58g wireless mouse with a 26k optical sensor.'],
  ['Drift Pro Mouse', 'MS-DRF-PR', 'mice', 3100000, 8, 'The Drift with a longer battery and magnetic charging dock.'],
  ['Pebble Vertical Mouse', 'MS-PBL-VT', 'mice', 1850000, 25, 'Vertical grip that keeps the wrist neutral through long sessions.'],
  ['Lumen 27" 4K Monitor', 'MN-LMN-27', 'monitors', 14500000, 5, 'Factory-calibrated 27-inch 4K panel with a single-cable USB-C dock.'],
  ['Lumen 34" Ultrawide', 'MN-LMN-34', 'monitors', 21900000, 2, 'Curved 34-inch ultrawide for editing timelines and wide IDE layouts.'],
  ['Field Monitor Arm', 'MN-ARM-01', 'monitors', 4200000, 18, 'Gas-spring arm rated to 9kg with tool-free clamp mounting.'],
  ['Cove Studio Headphones', 'AU-CVE-01', 'audio', 6750000, 14, 'Closed-back studio headphones with a replaceable cable and pads.'],
  ['Cove Wireless ANC', 'AU-CVE-NC', 'audio', 8950000, 4, 'Active noise cancelling over-ears with 40 hours of playback.'],
  ['Signal USB Microphone', 'AU-SGL-MC', 'audio', 3650000, 11, 'Cardioid condenser with a built-in shock mount and mute key.'],
  ['Ridge Laptop Stand', 'AC-RDG-ST', 'accessories', 1450000, 40, 'Folding aluminium stand that raises a laptop to eye level.'],
  ['Anchor 100W GaN Charger', 'AC-ANC-GN', 'accessories', 1950000, 22, 'Four-port GaN charger that runs a laptop and three devices at once.'],
  ['Cable Weave Organiser', 'AC-CBL-WV', 'accessories', 620000, 60, 'Magnetic cable channel that keeps a desk edge clear.'],
  ['Slate Desk Mat', 'AC-SLT-MT', 'accessories', 890000, 35, 'Water-resistant felt desk mat in a full 900x400mm footprint.'],
  ['Founders Edition Deskpad', 'AC-FND-DP', 'accessories', 1250000, 3, 'Numbered run of 50. Once these are gone they are gone.'],
  ['Atlas Travel Case', 'AC-ATL-TC', 'accessories', 2750000, 1, 'Hard-shell case sized for a 14-inch laptop and a 65% keyboard.'],
];

async function seed() {
  await connectDb();

  await Promise.all([
    Product.deleteMany({}),
    Cart.deleteMany({}),
    Order.deleteMany({}),
    Reservation.deleteMany({}),
    Payment.deleteMany({}),
    Refund.deleteMany({}),
    IdempotencyKey.deleteMany({}),
  ]);

  const created = await Product.insertMany(
    PRODUCTS.map(([name, sku, category, priceCents, totalStock, description]) => ({
      name,
      sku,
      category,
      priceCents,
      totalStock,
      description,
      reservedStock: 0,
      isActive: true,
    })),
  );

  console.log(`Seeded ${created.length} products across ${new Set(created.map((p) => p.category)).size} categories.`);
  console.log('Scarce lines for demoing reservations:');
  console.table(
    created
      .filter((product) => product.totalStock <= 5)
      .map(({ sku, name, totalStock }) => ({ sku, name, stock: totalStock })),
  );

  await disconnectDb();
}

seed().catch(async (error) => {
  console.error(error);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
