# Task 02 — E-Commerce Checkout & Payment System

A storefront end to end: search and filtering, product pages, a cart, a checkout
that reserves stock before it charges, a mock gateway with declines and timeouts,
refunds, and order history.

**Live app:** `<TASK-02-VERCEL-URL>` · **API:** `<TASK-02-RENDER-URL>`

Full architecture notes, the concurrency proof and the API reference live in the
[root README](../README.md). This file is the short operational version.

---

## Run it

```bash
# API — http://localhost:4002
cd backend
cp .env.example .env        # set MONGODB_URI (a different database name to task-01)
npm install
npm run seed                # 18 products across 5 categories
npm run dev

# UI — http://localhost:3002
cd ../frontend
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:4002
npm install
npm run dev
```

## Test it

```bash
cd backend
npm test     # 27 tests
```

Task 01's twenty tests plus seven more covering refunds and order history:
a refund reverses the charge and restocks, an order cannot be refunded twice, six
concurrent refund requests settle exactly one, an unpaid order is cancelled
rather than refunded, and a failed payment leaves nothing to refund.

## What is different from task 01

The backend is task 01's engine with three additions:

| Addition | Where |
|---|---|
| **Refunds** — a `Refund` model, a refund service, and `POST /api/orders/:id/refund` | `src/models/Refund.js`, `src/services/refund.service.js` |
| **Cancel-means-refund for paid orders** — cancelling a `PAID` order reverses the charge and lands in `REFUNDED`, not `CANCELLED` | `src/services/order.service.js` |
| **Product discovery** — free-text search plus composable category, price-range and availability filters, sorting, and facets for the UI | `src/routes/products.routes.js` |

Everything else — the reservation engine, the payment state machine, the
idempotency layer — is the same design, unchanged.

## The screens

| Screen | What it is for |
|---|---|
| **Shop** (`/`) | Search, category chips, price range, in-stock toggle, sorting |
| **Product** (`/products/[id]`) | Details, live availability, related items |
| **Cart** (`/cart`) | Quantities, removal, a warning if stock moved under you |
| **Checkout** (`/checkout`) | Details → stock reserved → payment, with a countdown |
| **My orders** (`/orders`) | History filtered by outcome |
| **Order** (`/orders/[id]`) | Status, payments, refunds, cancel and refund actions |

## Demoing it in one minute

1. Search `keyboard`, tick **In stock only**, open a product, add two to the cart.
2. Checkout. Step 2 holds your stock and starts a five-minute timer *before*
   showing the payment step.
3. Pay with the **declining card** — the order fails and your items go straight
   back on sale. Nothing was charged.
4. Check out again, pay with the **approved card**, then press
   **Cancel & request a refund**. The order becomes `REFUNDED`, a refund record
   appears with its own gateway reference, and the stock returns.
