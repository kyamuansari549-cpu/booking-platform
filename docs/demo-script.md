# Demo script (60 seconds)

Record at 1080p, no audio needed — or narrate the bold lines.

**0:00 — Landing → events** (5s)
Open `/`, click **Browse events**. Two seeded events, minimum prices shown.

**0:05 — Seat map** (15s)
Open an event. **"Pick any seat on the tiered map — rows, stage marker, live
availability."** Click 3 seats across two tiers, watch the total update. Click
**Hold seats**.

**0:20 — Checkout** (15s)
**"Seats are held for 10 minutes — the countdown is live."** Order summary shows
per-seat prices. Click **Pay** → Razorpay modal opens (test card
4111 1111 1111 1111). Payment succeeds → **"You're booked!"**

**0:35 — My bookings** (10s)
Open **My bookings** — booking shows CONFIRMED. Open the waitlist section
(empty for now).

**0:45 — Sold-out → waitlist** (10s)
*(Prep: in another browser, buy the last seats of a tier.)* Tier shows
**Join waitlist** → click → **"You're #1 on the waitlist."**

**0:55 — Organizer dashboard** (15s)
Open **Organizer → event → Dashboard**. **"Revenue, occupancy per tier,
14-day sales, attendee list."** Check in an attendee, then **Refund** a booking —
**"seats release and the waitlist gets offered automatically."**

**1:10 — Race condition** (optional kicker, terminal)
`npx tsx db/test-holds.ts` → **"Five concurrent requests, one seat, exactly
one winner — that's the row-lock test."**

## Prep checklist

- [ ] Prod DB migrated + seeded
- [ ] Razorpay **test** keys in env, webhook registered
- [ ] One tier pre-sold-out (or a second test user ready) for the waitlist beat
- [ ] Test card: 4111 1111 1111 1111, any future expiry, any CVV
