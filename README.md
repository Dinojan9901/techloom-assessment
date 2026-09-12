# Techloom.ai — Software Engineer Intern Practical Assessment

Two connected systems built around one problem: **selling a limited thing to several people at once without ever selling it twice.**

| | |
|---|---|
| **Repository** | `https://github.com/<your-username>/techloom-assessment` |
| **Task 01 — POS Order & Inventory** | live app: `<TASK-01-VERCEL-URL>` · API: `<TASK-01-RENDER-URL>` |
| **Task 02 — Storefront Checkout & Payment** | live app: `<TASK-02-VERCEL-URL>` · API: `<TASK-02-RENDER-URL>` |
| **Walkthrough video** | `<OPTIONAL-LOOM-URL>` |

> Replace the four placeholders above with the real URLs once deployed — see
> [Deployment](#deployment). Every other part of this README is ready as-is.

---

## Contents

- [The short version](#the-short-version)
- [Tech stack](#tech-stack)
- [How overselling is actually prevented](#how-overselling-is-actually-prevented)
- [The reservation clock](#the-reservation-clock)
- [Order lifecycle](#order-lifecycle)
- [Handling the four payment outcomes](#handling-the-four-payment-outcomes)
- [Repository layout](#repository-layout)
- [Running it locally](#running-it-locally)
- [Environment variables](#environment-variables)
- [How to test each feature](#how-to-test-each-feature)
- [Automated tests](#automated-tests)
- [API reference](#api-reference)
- [Deployment](#deployment)
- [Decisions and trade-offs](#decisions-and-trade-offs)

---

## The short version

**Task 01** is a point-of-sale back office: product CRUD, a till that builds a cart,
checkout that holds stock for five minutes, a mock card gateway, and a full order
lifecycle with cancellations that put stock back correctly.

**Task 02** is the customer-facing side of the same idea: a storefront with search
and filtering, a cart, a checkout that reserves before it charges, refunds, and
order history.

They share an engine. Task 02's backend *is* Task 01's backend with refunds and
product discovery added — the reservation logic, payment state machine and
idempotency layer are the same design in both. Each task is deployed
independently so neither can break the other.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js 22 + Express 4 (ES modules) | Small, explicit, nothing hiding the concurrency behaviour |
| Database | MongoDB 7 + Mongoose 8 | Atomic per-document updates plus multi-document transactions |
| Frontend | Next.js 16 (App Router) + React 19 | Server-rendered shell, client components where state is live |
| Validation | Zod | One schema per endpoint, typed errors out of the box |
| Tests | Jest + Supertest + `mongodb-memory-server` | Real HTTP against a real replica set, no mocks of the database |
| Hosting | Render (APIs) + Vercel (frontends) + MongoDB Atlas | All free tier |

No UI framework or component library — the styling is a small hand-written
design system in one stylesheet per app, so there is nothing to audit but CSS.

---

## How overselling is actually prevented

This is the part the whole assessment turns on, so it is worth being precise.

Stock is modelled as **two counters**, never one:

```
totalStock     units physically on the shelf   (changes only when a sale settles)
reservedStock  units held by an open checkout
available    = totalStock - reservedStock       (what a new shopper may take)
```

A reservation is taken with a **single conditional update**, where the
availability check is part of the filter rather than a separate read:

```js
Product.findOneAndUpdate(
  {
    _id: productId,
    isActive: true,
    $expr: { $gte: [{ $subtract: ['$totalStock', '$reservedStock'] }, quantity] },
  },
  { $inc: { reservedStock: quantity } },
  { new: true, session },
);
```

MongoDB guarantees atomicity at the document level, so of *N* concurrent
requests racing for the last unit, exactly one matches the filter and the rest
get `null` back. **There is no window between "is there stock?" and "take it"**
for a competing request to slip into — which is precisely the window a
read-then-write implementation leaves open.

Three things build on top of that primitive:

1. **Multi-line carts are all-or-nothing.** The holds run inside one transaction,
   so a cart that is short on any single line holds nothing at all. On a
   deployment without transactions the code compensates by releasing the holds it
   already took, so the outcome is the same.
2. **Lines are held in a stable order** (sorted by product id), so two carts
   containing the same two products cannot deadlock against each other.
3. **Write conflicts are retried.** Two transactions touching the same product
   produce a `TransientTransactionError`; `withTransaction` retries with backoff
   and the filter is re-evaluated against fresh data.

There is a test for this, and it is the first one worth running:

```
50 simultaneous checkouts for 5 units reserve exactly 5   ✓
```

See [`task-01/backend/tests/concurrency.test.js`](task-01/backend/tests/concurrency.test.js).

---

## The reservation clock

Entering checkout creates a `Reservation` with an `expiresAt` five minutes out.
Three independent mechanisms make sure stock never stays stuck:

| Mechanism | What it covers |
|---|---|
| **Background sweeper** (every 15s) | The normal case — an abandoned checkout |
| **Read-through check** | A stale order can never be paid, even between sweeps |
| **Stale-order sweep** | A crash between writes that left an order holding stock with no live reservation |

A reservation is released by **claiming it first**:

```js
Reservation.findOneAndUpdate(
  { _id, status: 'ACTIVE' },
  { $set: { status: 'RELEASED', releaseReason: reason } },
);
```

If the claim returns `null`, someone else already handled it and this caller does
nothing. That is what lets the sweeper, an explicit cancellation and a failed
payment all race for the same reservation while the stock is still returned
**exactly once**.

A MongoDB TTL index would have been simpler, and is wrong here: an expiring
reservation has to *give its stock back*, which means running logic, not deleting
a document.

---

## Order lifecycle

```
   PENDING ──checkout──▶ RESERVED ──pay──▶ PROCESSING ──▶ PAID
      │                     │                  │            │
      │                     ├─ cancel ──▶ CANCELLED ◀───────┤
      │                     ├─ expire ──▶ EXPIRED           │
      └─ cancel/expire ─────┘              ▲                └─ refund ──▶ REFUNDED
                                           │
                                    (timeout lands here)
```

Transitions are declared in one table
([`lib/order-status.js`](task-01/backend/src/lib/order-status.js)) and every move
goes through `transitionOrder`, which puts the expected current status **into the
update's filter**:

```js
Order.findOneAndUpdate(
  { _id: orderId, status: { $in: legalFrom } },
  { $set: { status: to }, $push: { statusHistory: { status: to, reason } } },
);
```

So the read-check-write is a single operation. Two concurrent callers cannot both
see `RESERVED` and both proceed — the loser gets `null` and a `409`, not a
corrupted order. **This is the mechanism behind duplicate-payment detection**, and
it is why `PROCESSING` exists as a distinct state: claiming an order for payment
*is* a state transition.

Every order carries its own `statusHistory`, so the UI renders the real audit
trail rather than a guess.

---

## Handling the four payment outcomes

The mock gateway ([`services/gateway.mock.js`](task-01/backend/src/services/gateway.mock.js))
can be forced into any outcome for demos and tests, or left on weighted random
(70% approve / 20% decline / 10% timeout) to behave like an unpredictable third
party.

| Outcome | HTTP | Order becomes | Stock |
|---|---|---|---|
| **Success** | `201` | `PAID` | Held units become sold units |
| **Failure** | `402` | `FAILED` | Hold released immediately, back on sale |
| **Timeout** | `504` | `EXPIRED` | Hold released — the customer can start fresh |
| **Duplicate** | `409` | unchanged | Untouched |

Declines and timeouts answer with a non-2xx status *and* the full resulting
order, because they are handled business outcomes rather than server errors — the
client needs the order they produced.

**Duplicate submissions are stopped at three levels**, deliberately:

1. **The order state machine** — `RESERVED → PROCESSING` is atomic, so of two
   clicks on Pay only one reaches the gateway.
2. **`Idempotency-Key` headers** — a retried request replays the original stored
   response verbatim; the same key with a *different* body is rejected as a
   client bug rather than quietly doing something new.
3. **A unique partial index** on `{ order: 1 }` where `outcome: 'SUCCESS'` — the
   database itself refuses a second successful charge for one order.

Any one of these would mostly work. Together they hold under a retrying client,
a double-clicking user, and two server instances at once.

---

## Repository layout

```
.
├── render.yaml                  Render Blueprint — deploys both APIs
├── task-01/                     POS Order & Inventory System
│   ├── backend/
│   │   ├── src/
│   │   │   ├── config/          env parsing, DB connection, transaction support probe
│   │   │   ├── lib/             errors, HTTP helpers, idempotency, state machine, transactions
│   │   │   ├── models/          Product, Cart, Order, Reservation, Payment, IdempotencyKey
│   │   │   ├── routes/          products, carts, orders (+ payment, cancel)
│   │   │   ├── services/        inventory, reservation, order, payment, mock gateway
│   │   │   └── scripts/seed.js
│   │   └── tests/               concurrency, lifecycle, payment
│   └── frontend/                Next.js — register, inventory, orders
└── task-02/                     E-Commerce Checkout & Payment System
    ├── backend/                 the same engine + Refund model, refund service, discovery
    │   └── tests/               concurrency, lifecycle, payment, refund
    └── frontend/                Next.js — storefront, product, cart, checkout, order history
```

---

## Running it locally

**Prerequisites:** Node.js 20+ and a MongoDB connection string.

> **On MongoDB:** the transactional paths need a **replica set**. A MongoDB Atlas
> free M0 cluster is one out of the box — use that and everything works. A bare
> local `mongod` is not, and the app detects this and falls back to atomic
> per-document updates with compensating rollback. The no-overselling guarantee
> holds either way; only the multi-line all-or-nothing path changes technique.

Four terminals, or run one task at a time:

```bash
# ── Task 01 ──────────────────────────────────────────────
cd task-01/backend
cp .env.example .env          # then set MONGODB_URI
npm install
npm run seed                  # 12 products, some deliberately scarce
npm run dev                   # http://localhost:4001

cd task-01/frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:4001
npm install
npm run dev                   # http://localhost:3001

# ── Task 02 ──────────────────────────────────────────────
cd task-02/backend
cp .env.example .env          # set MONGODB_URI (use a *different* database name)
npm install
npm run seed                  # 18 products across 5 categories
npm run dev                   # http://localhost:4002

cd task-02/frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:4002
npm install
npm run dev                   # http://localhost:3002
```

---

## Environment variables

### Backends (`task-01/backend/.env`, `task-02/backend/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/techloom_pos` | **Required.** Use a replica set (Atlas) for transactions |
| `PORT` | `4001` / `4002` | HTTP port |
| `CORS_ORIGINS` | `*` | Comma-separated allowed browser origins |
| `RESERVATION_TTL_MINUTES` | `5` | The reservation window. **Set to `1` to watch expiry live** |
| `SWEEPER_INTERVAL_MS` | `15000` | How often lapsed reservations are swept |
| `PAYMENT_TIMEOUT_MS` | `1500` | How long a simulated timeout hangs |
| `PAYMENT_WEIGHT_SUCCESS` | `70` | Weight for random outcomes |
| `PAYMENT_WEIGHT_FAILURE` | `20` | " |
| `PAYMENT_WEIGHT_TIMEOUT` | `10` | " |

### Frontends (`.env.local`)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of that task's backend, no trailing slash |

---

## How to test each feature

Each of these is a thing you can do in the deployed UI in under a minute.

### Task 01 — POS

**1. No overselling, by hand.**
Open the Register in **two browser windows** (use a private window for the second
— each browser gets its own terminal id). Find *Barista Keep Cup*, stock **1**.
Add it in both windows, then hit Checkout in both. One gets an order; the other
gets *"Insufficient stock available"*. The product tile in the first window
immediately shows `0 available · 1 held in checkout`.

**2. No overselling, under real load.**
```bash
cd task-01/backend && npm run test:concurrency
```
Fires 50 simultaneous checkouts at a 5-unit product and asserts exactly 5 succeed.

**3. The five-minute hold.**
Check out anything. The order page shows a live countdown and the Inventory page
shows the units as *held*, not sold. Now either wait it out, or go to **Orders →
Run expiry sweep now** to force it. The order flips to `EXPIRED` and the stock
returns to available. (Set `RESERVATION_TTL_MINUTES=1` to make this quick.)

**4. Each payment outcome.**
On any reserved order the sidebar has four buttons: *random*, *force success*,
*force decline*, *force timeout*. Watch what each does to the status and to
inventory — success sells the units, decline and timeout both put them back.

**5. Duplicate payment.**
Force a success, then press any Pay button again. `409 — This order has already
been paid`. Stock does not move twice.

**6. Cancellation restores stock.**
Cancel a `RESERVED` order → the hold is released. Cancel a `PAID` order → the
sold units go back on the shelf. Both are visible on the Inventory page.

**7. Product CRUD.** Inventory → add, edit, restock with `+`/`−`, retire. Note
that restocking changes the shelf only; units held by an open checkout stay held.

### Task 02 — Storefront

**8. Search and filtering.** Type `keyboard`, filter by category, set a price
range, tick *In stock only*, change the sort. Filters compose, and *in stock only*
respects live reservations — an item someone else is checking out with drops out.

**9. Checkout reserves before it charges.** Add items → Cart → Checkout. Step 2
holds your stock and starts the timer *before* the payment step is shown.

**10. The four cards.** The payment step offers an approved card, a declining
card, an unresponsive gateway, and a real-world random card. Each is handled
distinctly and the order page explains what happened and what to do next.

**11. Refunds.** Buy something with the approved card, then on the order press
*Cancel & request a refund*. The order becomes `REFUNDED`, a refund record with a
gateway reference appears, and the units go straight back on sale.

**12. Order history.** *My orders* lists every order from this browser with its
current status, filterable by outcome. It updates on its own if a reservation
lapses while you are looking at it.

---

## Automated tests

```bash
cd task-01/backend && npm test     # 20 tests
cd task-02/backend && npm test     # 27 tests
```

Both suites boot a real single-node **replica set** in memory
(`mongodb-memory-server`) and drive the real Express app over HTTP with Supertest.
Nothing about the database is mocked, so the transaction and write-conflict paths
are genuinely exercised rather than assumed.

What they cover:

| Area | Assertions |
|---|---|
| **Concurrency** | 50 parallel checkouts for 5 units reserve exactly 5; reserved never exceeds total across mixed quantities; a short line in a multi-line cart holds nothing; 8 parallel payments charge once |
| **Reservations** | The window is 5 minutes; expiry releases stock and expires the order; sweeping twice releases once; an expired order cannot be paid |
| **Lifecycle** | Cancelling restores stock for both reserved and paid orders; a cancelled order cannot be cancelled again; status history is complete and ordered; a cart cannot be checked out twice |
| **Payments** | Success, decline and timeout each land in the right state with the right stock effect; a failed order cannot be retried on a dead reservation; exactly one payment record per order |
| **Idempotency** | A retried checkout returns the original order and takes no second hold; a key reused with a different body is rejected |
| **Refunds** (task 02) | A refund reverses the charge and restocks; an order cannot be refunded twice; 6 concurrent refund requests settle exactly one; an unpaid order is cancelled rather than refunded; a failed payment leaves nothing to refund |
| **History** (task 02) | Scoped to the shopper, newest first, reflecting final statuses |

---

## API reference

Both APIs share this shape. Task 02 adds `POST /api/orders/:id/refund` and richer
product filtering. A session is identified by an `X-Session-Id` header the client
generates once and stores.

### Products

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/products` | `?search=&category=&minPrice=&maxPrice=&inStock=true&sort=price-asc` — also returns category and price-range facets |
| `GET` | `/api/products/:id` | Task 02 also returns related products |
| `POST` | `/api/products` | Create |
| `PATCH` | `/api/products/:id` | Update. `reservedStock` is not writable |
| `DELETE` | `/api/products/:id` | Soft-deletes; `?hard=true` only when nothing is held |

### Cart

| Method | Path |
|---|---|
| `GET` | `/api/carts/current` |
| `POST` | `/api/carts/current/items` |
| `PATCH` | `/api/carts/current/items/:productId` |
| `DELETE` | `/api/carts/current/items/:productId` |
| `DELETE` | `/api/carts/current` |

### Orders

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/orders/checkout` | Reserves stock, returns a `RESERVED` order. Accepts `Idempotency-Key` |
| `POST` | `/api/orders/:id/pay` | `{ "simulate": "success" \| "failure" \| "timeout" }`, omit for random |
| `POST` | `/api/orders/:id/cancel` | Releases a hold, or refunds a paid order (task 02) |
| `POST` | `/api/orders/:id/refund` | **Task 02.** Reverses a capture and restocks |
| `GET` | `/api/orders` | `?status=PAID,FAILED&all=true` |
| `GET` | `/api/orders/:id` | Order, payments, refunds, allowed next states, seconds remaining |
| `GET` | `/api/orders/meta/statuses` | The state machine itself |
| `POST` | `/api/admin/sweep` | Runs the expiry sweep on demand, for testing |

### Error shape

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "…", "details": { } } }
```

`INSUFFICIENT_STOCK` · `DUPLICATE_REQUEST` · `INVALID_STATE_TRANSITION` ·
`RESERVATION_EXPIRED` · `VALIDATION_ERROR` · `NOT_FOUND`

---

## Deployment

### 1. Database — MongoDB Atlas (free M0)

Create a cluster, add a database user, and allow access from anywhere
(`0.0.0.0/0`) so Render can reach it. Take the connection string. Use **two
database names** — one per task — so the two systems never share collections:

```
mongodb+srv://user:pass@cluster.mongodb.net/techloom_pos?retryWrites=true&w=majority
mongodb+srv://user:pass@cluster.mongodb.net/techloom_shop?retryWrites=true&w=majority
```

### 2. Backends — Render

Easiest path: **New → Blueprint**, point it at this repository. `render.yaml`
creates both services; Render prompts for `MONGODB_URI` on each.

Manually instead: New → Web Service, per backend —

| Setting | task-01 | task-02 |
|---|---|---|
| Root directory | `task-01/backend` | `task-02/backend` |
| Build command | `npm ci` | `npm ci` |
| Start command | `npm start` | `npm start` |
| Health check | `/api/health` | `/api/health` |

Then seed each database once. Render's Shell tab needs a paid instance type, so
on the free tier run the seed locally against the Atlas connection string
instead — the seed script only ever talks to the database, so where it runs from
makes no difference:

```bash
cd task-01/backend && MONGODB_URI="<the techloom_pos URI>" npm run seed
cd task-02/backend && MONGODB_URI="<the techloom_shop URI>" npm run seed
```

This doubles as a check that the Atlas URI works before Render is involved.

> Render's free tier sleeps after inactivity, so the first request after a quiet
> spell takes ~30 seconds to wake. Worth knowing before judging the demo's speed.

### 3. Frontends — Vercel

Import the repository twice:

| Setting | task-01 | task-02 |
|---|---|---|
| Root directory | `task-01/frontend` | `task-02/frontend` |
| Framework | Next.js (auto) | Next.js (auto) |
| `NEXT_PUBLIC_API_URL` | the task-01 Render URL | the task-02 Render URL |

### 4. Close the loop

Set `CORS_ORIGINS` on each Render service to its Vercel URL, then paste all four
URLs into the table at the top of this file.

---

## Decisions and trade-offs

**Two counters instead of one.** Keeping `reservedStock` separate from
`totalStock` means a reservation never has to be undone against a moving target,
and `available` cannot be driven below zero by a filter that checks it. The cost
is that two fields must stay consistent — which is what the transactions and the
claim-before-release pattern are for.

**Money in minor units.** Prices are integer cents throughout. Floating-point
currency is a bug waiting for a decimal.

**A sweeper, not a TTL index.** Expiry has to run logic, not delete a row.

**`PROCESSING` as a real state.** It looks like an extra step until you need to
answer "is someone already paying for this?" atomically. Then it is the answer.

**Each task deployed independently.** The two backends share a design, not a
package. A shared workspace package would have been DRYer and is the standard
monorepo answer — but deployment is a hard requirement here, and workspace
linking is the most common way Vercel and Render deploys fail. Two independent
services also mean one task cannot break the other.

**Sessions instead of auth.** Neither brief asks for accounts, so a browser-
generated `X-Session-Id` scopes carts and order history. Real auth would slot in
at the same boundary without touching the reservation engine.

**Soft deletes for products.** A product with order history has to keep existing
for that history to render. Hard delete is available, but only when nothing is
held.

### What I would do next, with more time

- **Move the sweeper out of the web process.** It is an interval in each API
  instance today, which is fine for one instance and merely wasteful for several
  (the claim-before-release pattern makes it safe either way). A single worker or
  a Mongo change stream would be tidier.
- **A webhook path for the gateway.** Real gateways answer asynchronously; a
  timeout here ends the order, where production would reconcile later.
- **Rate limiting and auth** on the write endpoints, which are currently open.
- **Structured logging** with a request id, instead of `morgan` plus `console`.
