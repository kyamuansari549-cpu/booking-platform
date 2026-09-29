# Booking Platform — Build Plan

**Product:** Event booking platform with seat selection, payments, waitlists, refunds.
**Why:** Full-stack interview signal — auth, realtime seat holds, payment webhooks, queues, dashboards.
**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · Drizzle ORM + Postgres · Auth.js v5 (Google, JWT) · Razorpay · Redis (Upstash) seat holds · Vercel + Neon

## Phase 1 — Foundation ✅ (in progress)
- [x] Next.js scaffold, Tailwind, TS
- [x] Prisma schema (users, events, tiers, seats, bookings, payments, waitlist)
- [x] `.env.example`, Prisma client singleton
- [ ] Auth.js: Google OAuth + Prisma adapter, sign-in/out UI
- [ ] Seed script: demo organizer + 2 events with seat maps
- [ ] Base layout, landing page, auth-gated routes

## Phase 2 — Events & booking flow
- Event CRUD for organizers (draft → published)
- Seat-map designer: rows × seats per tier, auto-generate labels (A-1…)
- Public event listing + event detail with interactive seat map
- Seat hold: select seats → 10-min hold via Redis TTL (DB fallback), booking in PENDING
- Checkout page; hold expiry sweeper (cron/interval)
- My bookings page

## Phase 3 — Payments, waitlist, refunds
- Razorpay order creation + checkout.js integration
- Webhook: verify signature → CONFIRM booking, mark seats SOLD
- Failure path: payment failed → release seats
- Sold-out → waitlist join; on cancellation, offer seats in position order (24h offer window)
- User-initiated cancellation + Razorpay refunds → REFUNDED, seats released

## Phase 4 — Organizer dashboard
- Sales overview: revenue, tickets sold, occupancy per tier
- Attendee list, check-in toggle (QR optional stretch)
- Event analytics charts, refund management

## Phase 5 — Ship it
- Deploy: Vercel + Neon + Upstash
- README: architecture diagram, setup, API notes, demo credentials
- Seed demo data on prod, record 60-sec demo video/GIF
- Resume bullets + talking points

## Decisions (defaults — flag to change)
- Payments: **Razorpay** (INR-native). Needs test API keys from user.
- DB: **Neon** free tier. Needs user to create project → DATABASE_URL.
- Redis: **Upstash** free tier. Needs user to create DB → REDIS_URL.
- Auth: Google OAuth only (fastest credible). Needs OAuth client ID/secret.
