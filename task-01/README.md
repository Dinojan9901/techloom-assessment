# Task 01 — POS Order & Inventory System

Concurrency-safe point-of-sale: product CRUD, a till, five-minute stock
reservations, a mock card gateway, and an order lifecycle where cancelling
always puts inventory back exactly right.

**Live app:** <https://techloom-pos-iota.vercel.app> · **API:** <https://techloom-pos-api.vercel.app/api/health>

Full architecture notes, the concurrency proof and the API reference live in the
[root README](../README.md). This file is the short operational version.

---

## Run it

```bash
# API — http://localhost:4001
cd backend
cp .env.example .env        # set MONGODB_URI
npm install
npm run seed                # 12 products, some deliberately scarce
npm run dev

# UI — http://localhost:3001
cd ../frontend
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:4001
npm install
npm run dev
```

MongoDB needs to be a replica set for the transactional paths — a MongoDB Atlas
free M0 cluster is one by default. A standalone `mongod` also works; the app
detects it and falls back to atomic per-document updates with compensating
rollback.

## Test it

```bash
cd backend
npm test                # 20 tests
npm run test:concurrency   # just the overselling proof
```

The concurrency suite fires 50 simultaneous checkouts at a 5-unit product and
asserts exactly 5 succeed, with `reservedStock` landing on 5 and `available` on 0.

## The three screens

| Screen | What it is for |
|---|---|
| **Register** (`/`) | The till. Product grid with live availability, cart, checkout |
| **Inventory** (`/products`) | CRUD, restocking, and a meter showing held vs free stock |
| **Orders** (`/orders`) | Every order, its status, and a button to force the expiry sweep |

The order detail screen (`/orders/[id]`) is where the interesting behaviour is:
a live countdown on the reservation, four buttons to force each payment outcome,
cancellation, and the order's real status history.

## Demoing it in one minute

1. Open the Register in two browsers. Both add *Barista Keep Cup* (stock: 1).
2. Both press Checkout. One wins; the other is told the stock is gone.
3. On the winning order, press **Force timeout** — the hold is released and the
   order expires.
4. Refresh the loser's Register. The cup is available again.

Set `RESERVATION_TTL_MINUTES=1` in `.env` to watch a natural expiry without
waiting five minutes, or use **Orders → Run expiry sweep now**.
