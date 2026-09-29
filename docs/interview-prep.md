# Interview prep

## Resume bullets (pick 2–3)

- Built **SeatBook**, a full-stack event booking platform (Next.js 16, TypeScript,
  Drizzle ORM, PostgreSQL) with interactive seat maps, atomic 10-minute seat
  holds, Razorpay payments, waitlists, and an organizer analytics dashboard.
- Implemented **race-safe seat holds** with Postgres `SELECT … FOR UPDATE` row
  locking plus a Redis fast-fail layer; verified with a 5-way concurrency test —
  exactly one request wins a contested seat.
- Designed an **idempotent payment state machine** (HMAC-verified Razorpay
  webhooks, replay-safe confirms, auto-refund on late capture after hold expiry);
  80 logic tests run against in-process Postgres (PGlite), all passing.
- Built a **fair waitlist**: position ordering, 24h offers on freed seats with
  expiry cascade, and claim-via-hold — plus organizer tooling (revenue/occupancy
  analytics, attendee check-in, scoped refunds).

## Talking points

**"How do you prevent double-booking?"**
> The hold runs in a single Postgres transaction: `SELECT … FOR UPDATE` on the
> requested seats, verify all are AVAILABLE and belong to one event, then insert
> the PENDING booking and flip seats to HELD. Row locks serialize concurrent
> requests — losers get a 409 and the map refreshes. Redis `SET NX EX 600` is a
> best-effort fast-fail so obviously-contended seats reject without hitting the
> DB, but Postgres is the source of truth, so a Redis outage can't cause a
> double-booking. I test this with 5 concurrent holds racing for one seat.

**"What happens if the payment succeeds but the webhook never arrives?"**
> Two paths confirm a booking: the checkout.js `handler` calls
> `/api/payments/verify` (HMAC signature check → confirm), and the webhook
> `payment.captured` confirms idempotently as a backstop. Either can arrive
> first; the second is a no-op.

**"What if the user pays after their 10-minute hold expired?"**
> That's the late-capture edge. Verify re-checks hold validity *after* signature
> verification: if the hold lapsed, it records the payment as CAPTURED and
> auto-refunds via the Razorpay API instead of confirming. The webhook path does
> the same recording without the refund, so the organizer can refund from the
> dashboard. `recordCapturedPayment` only touches CREATED/AUTHORIZED rows, so it
> can never clobber a REFUNDED payment on replay.

**"How does the waitlist stay fair?"**
> Positions are assigned as max+1 per event at join time. When seats free up
> (cancellation/refund), the earliest WAITING entry for that tier is OFFERED with
> a 24h TTL. If the user holds seats, the offer is ACCEPTED; if the TTL lapses, it
> expires and the next entry is offered automatically — a cron sweeps every 5
> minutes and event pages also expire lazily on read.

**"Why Drizzle over Prisma here?"**
> Prisma's engine downloads kept failing in this environment and v8 changed the
> CLI surface; Drizzle is SQL-forward with zero engine binaries, which also made
> the PGlite test setup trivial — the same SQL migrations run in-process.

**"What would you do with more time?"**
> QR-code tickets for check-in, organizer payout reports, promo codes, and
> moving the hold-expiry sweeper to a proper queue (e.g. BullMQ) instead of cron
> + lazy expiry. Also Postgres advisory locks as an alternative to row locks if
> hold contention ever became a hotspot.
