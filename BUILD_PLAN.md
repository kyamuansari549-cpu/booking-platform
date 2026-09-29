# Booking Platform — Build Plan

**Product:** Event booking platform with seat selection, payments, waitlists, refunds.
**Why:** Full-stack interview signal — auth, realtime seat holds, payment webhooks, queues, dashboards.
**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · Drizzle ORM + Postgres · Auth.js v5 (Google, JWT) · Razorpay · Redis (Upstash) seat holds · Vercel + Neon

## Phase 1 — Foundation ✅
- Next.js scaffold, Tailwind, TS
- Drizzle schema (users, events, tiers, seats, bookings, payments, waitlist)
- Auth.js v5: Google OAuth, JWT sessions, role sync
- Seed script: 2 demo events, 320 seats
- Landing page + authenticated header

## Phase 2 — Events & booking flow ✅
- Event CRUD for organizers (draft → published)
- Seat-map designer: rows × seats per tier, auto-generated labels (A-1…)
- Public event listing + event detail with interactive seat map
- Seat hold: 10-min hold (SELECT FOR UPDATE + Redis fast-fail), PENDING booking
- Checkout page with live countdown; expiry sweeper (cron route + lazy expiry on read)
- My bookings page
- Hold logic verified: 12/12 tests on PGlite incl. 5-way race for one seat

## Phase 3 — Payments, waitlist, refunds ✅
- Razorpay order creation + checkout.js integration (`/api/payments/orders`, `/api/payments/verify`)
- Webhook (`/api/webhooks/razorpay`): raw-body signature verification, idempotent
  `payment.captured` → CONFIRMED / SOLD, `payment.failed` → release
- Late-capture edge: payment captured after hold lapsed → recorded + auto-refunded
  (verify path) or recorded for organizer refund (webhook path)
- Waitlist: join/leave, position ordering, 24h offers on freed seats, expiry cascade,
  claim via hold
- User cancellation: PENDING → release; CONFIRMED → Razorpay refund → REFUNDED
- 36/36 payment + waitlist tests on PGlite

## Phase 4 — Organizer dashboard ✅
- Overview: revenue, tickets sold, events, waitlist totals
- Per-event dashboard: stat cards, per-tier table with occupancy bars, 14-day sales
  SVG chart, attendee list
- Check-in toggle (`checkedInAt` on bookings, migration 0001)
- Organizer-initiated refunds (scoped to own events)
- 32/32 organizer tests on PGlite

## Phase 5 — Ship it ✅
- `vercel.json` cron (every 5 min) for the hold/offer sweeper
- README with architecture diagram, setup, API notes
- `docs/demo-script.md` — 60-second demo walkthrough
- `docs/interview-prep.md` — resume bullets + talking points
- ⏳ Needs from user: Neon DATABASE_URL, Auth.js secret + Google OAuth keys,
  Razorpay test keys + webhook secret, Upstash Redis URL/token → then deploy

## Decisions
- Payments: **Razorpay** (INR-native). Test-mode keys required for live checkout.
- DB: **Neon** Postgres. `DATABASE_URL` required for migrate/seed/deploy.
- Seat holds: **Postgres is the source of truth** (`SELECT … FOR UPDATE`); Redis
  (Upstash) is a best-effort fast-fail layer only.
- Auth: Google OAuth only (Auth.js v5, JWT sessions).
- Money-safety rule: every payment state transition is idempotent and
  signature-verified; no transition can lose or double-count money.
