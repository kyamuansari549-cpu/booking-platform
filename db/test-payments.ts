/**
 * Tests for payments + waitlist logic against PGlite (in-process Postgres).
 * Covers: Razorpay signature verification, idempotent confirm, fail path,
 * refund state machine (with a fake provider fn), waitlist ordering, offer
 * cascade on refund, offer expiry, and offer claim via hold.
 * Run: npx tsx db/test-payments.ts
 */
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { createHold, getBookingForUser, type Db } from "@/lib/holds";
import {
  confirmBookingPayment,
  ensurePaymentForBooking,
  failBookingPayment,
  recordCapturedPayment,
  refundBooking,
} from "@/lib/payments";
import {
  acceptWaitlistOffer,
  expireStaleOffers,
  fulfillWaitlist,
  joinWaitlist,
  leaveWaitlist,
} from "@/lib/waitlist";
import {
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "@/lib/razorpay";

const pg = new PGlite();
const tdb = drizzle(pg, { schema });
const db = tdb as unknown as Db;

const TEST_SECRET = "test_webhook_secret_123";

let passed = 0;
function ok(name: string, cond: boolean) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok: ${name}`);
}

async function main() {
  const sql = readFileSync("db/migrations/0000_wet_dorian_gray.sql", "utf8");
  await pg.exec(sql);

  // ---- fixture: event with one tier, 2 seats ----
  const [owner] = await tdb
    .insert(schema.users)
    .values({ email: "owner@p.demo", name: "Owner" })
    .returning();
  const [buyer] = await tdb
    .insert(schema.users)
    .values({ email: "buyer@p.demo", name: "Buyer" })
    .returning();
  const [w1] = await tdb
    .insert(schema.users)
    .values({ email: "w1@p.demo", name: "Waiter 1" })
    .returning();
  const [w2] = await tdb
    .insert(schema.users)
    .values({ email: "w2@p.demo", name: "Waiter 2" })
    .returning();
  const [event] = await tdb
    .insert(schema.events)
    .values({
      title: "Payment Test Gig",
      description: "desc",
      venue: "Hall",
      city: "BLR",
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 90000000),
      status: "PUBLISHED",
      organizerId: owner.id,
    })
    .returning();
  const [tier] = await tdb
    .insert(schema.ticketTiers)
    .values({ eventId: event.id, name: "General", price: 50000, capacity: 2 })
    .returning();
  const seatRows = await tdb
    .insert(schema.seats)
    .values(
      ["B-1", "B-2"].map((label, i) => ({
        tierId: tier.id,
        label,
        row: "B",
        number: i + 1,
      }))
    )
    .returning({ id: schema.seats.id });
  const [s1, s2] = seatRows.map((s) => s.id);

  // ---- 1. signature verification ----
  const orderId = "order_test123";
  const paymentId = "pay_test456";
  const sig = crypto
    .createHmac("sha256", TEST_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  ok("valid payment signature verifies", verifyPaymentSignature(orderId, paymentId, sig, TEST_SECRET));
  ok(
    "tampered payment signature rejected",
    !verifyPaymentSignature(orderId, paymentId, sig.slice(0, -1) + "0", TEST_SECRET)
  );
  const rawBody = JSON.stringify({ event: "payment.captured" });
  const wsig = crypto.createHmac("sha256", TEST_SECRET).update(rawBody).digest("hex");
  ok("valid webhook signature verifies", verifyWebhookSignature(rawBody, wsig, TEST_SECRET));
  ok("tampered webhook signature rejected", !verifyWebhookSignature(rawBody, "deadbeef", TEST_SECRET));

  // ---- 2. hold + confirm ----
  const hold = await createHold(db, buyer.id, event.id, [s1, s2]);
  const p1 = await ensurePaymentForBooking(db, hold.bookingId, hold.totalAmount);
  ok("payment row created in CREATED", p1.status === "CREATED");
  const p1again = await ensurePaymentForBooking(db, hold.bookingId, hold.totalAmount);
  ok("ensurePaymentForBooking idempotent", p1again.id === p1.id);
  await tdb
    .update(schema.payments)
    .set({ providerOrderId: orderId })
    .where(eq(schema.payments.id, p1.id));

  const res1 = await confirmBookingPayment(db, hold.bookingId, paymentId);
  ok("confirm returns confirmed", res1 === "confirmed");
  const [b1] = await tdb.select().from(schema.bookings).where(eq(schema.bookings.id, hold.bookingId));
  ok("booking CONFIRMED", b1.status === "CONFIRMED");
  const [pay1] = await tdb.select().from(schema.payments).where(eq(schema.payments.id, p1.id));
  ok("payment CAPTURED with provider id", pay1.status === "CAPTURED" && pay1.providerPaymentId === paymentId);
  const soldSeats = await tdb.select({ status: schema.seats.status }).from(schema.seats).where(eq(schema.seats.tierId, tier.id));
  ok("seats SOLD", soldSeats.every((s) => s.status === "SOLD"));

  // ---- 3. webhook replay is idempotent ----
  const res2 = await confirmBookingPayment(db, hold.bookingId, paymentId);
  ok("replay confirm returns already", res2 === "already");
  const [pay1b] = await tdb.select().from(schema.payments).where(eq(schema.payments.id, p1.id));
  ok("replay does not duplicate state", pay1b.status === "CAPTURED");

  // ---- 4. waitlist join ordering ----
  const e1 = await joinWaitlist(db, w1.id, event.id, tier.id, 2);
  ok("first waiter position 1", e1.position === 1);
  const e2 = await joinWaitlist(db, w2.id, event.id, tier.id, 1);
  ok("second waiter position 2", e2.position === 2);
  let dup = false;
  try {
    await joinWaitlist(db, w1.id, event.id, tier.id, 1);
  } catch {
    dup = true;
  }
  ok("duplicate join rejected", dup);
  let unpub = false;
  const [draftEvent] = await tdb
    .insert(schema.events)
    .values({
      title: "Draft",
      description: "d",
      venue: "H",
      city: "BLR",
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 90000000),
      status: "DRAFT",
      organizerId: owner.id,
    })
    .returning();
  try {
    await joinWaitlist(db, w1.id, draftEvent.id, null, 1);
  } catch {
    unpub = true;
  }
  ok("cannot join waitlist of unpublished event", unpub);

  // ---- 5. refund frees seats + offers to first waiter ----
  const fakeRefund = async (pid: string, amt: number) => {
    ok("refund called with provider payment id", pid === paymentId);
    ok("refund called with full amount", amt === hold.totalAmount);
    return "rfnd_test789";
  };
  const { refundId } = await refundBooking(db, hold.bookingId, buyer.id, fakeRefund);
  ok("refund returns refund id", refundId === "rfnd_test789");
  const [b2] = await tdb.select().from(schema.bookings).where(eq(schema.bookings.id, hold.bookingId));
  ok("booking REFUNDED", b2.status === "REFUNDED");
  const [pay2] = await tdb.select().from(schema.payments).where(eq(schema.payments.id, p1.id));
  ok("payment REFUNDED", pay2.status === "REFUNDED");
  const freeSeats = await tdb.select({ status: schema.seats.status }).from(schema.seats).where(eq(schema.seats.tierId, tier.id));
  ok("seats AVAILABLE after refund", freeSeats.every((s) => s.status === "AVAILABLE"));
  const [offered1] = await tdb.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, e1.id));
  ok("first waiter OFFERED after refund", offered1.status === "OFFERED");
  const [stillWaiting] = await tdb.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, e2.id));
  ok("second waiter still WAITING", stillWaiting.status === "WAITING");

  // ---- 6. offer claim: waiter holds seats → ACCEPTED ----
  const claimHold = await createHold(db, w1.id, event.id, [s1]);
  await acceptWaitlistOffer(db, w1.id, event.id);
  const [claimed] = await tdb.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, e1.id));
  ok("claimed offer ACCEPTED", claimed.status === "ACCEPTED");
  void claimHold;

  // ---- 7. offer expiry cascades to next in line ----
  // w2 is WAITING; offer them manually, backdate, expire → w2 EXPIRED... no:
  // w2 is the only WAITING entry left. Offer it, backdate past TTL, expire.
  const offeredId = await fulfillWaitlist(db, event.id, tier.id);
  ok("next waiter offered", offeredId === e2.id);
  await tdb
    .update(schema.waitlistEntries)
    .set({ offeredAt: new Date(Date.now() - 25 * 3600 * 1000) })
    .where(eq(schema.waitlistEntries.id, e2.id));
  const expiredCount = await expireStaleOffers(db);
  ok("stale offer expired", expiredCount === 1);
  const [expiredEntry] = await tdb.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, e2.id));
  ok("entry marked EXPIRED", expiredEntry.status === "EXPIRED");

  // ---- 8. leave waitlist ----
  const e3 = await joinWaitlist(db, w2.id, event.id, tier.id, 1);
  const left = await leaveWaitlist(db, w2.id, e3.id);
  ok("leave waitlist works", left);
  const [gone] = await tdb.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, e3.id));
  ok("entry deleted", !gone);

  // ---- 9. fail path: failed payment releases the hold ----
  const [tier2] = await tdb
    .insert(schema.ticketTiers)
    .values({ eventId: event.id, name: "VIP", price: 90000, capacity: 1 })
    .returning();
  const [vipSeat] = await tdb
    .insert(schema.seats)
    .values({ tierId: tier2.id, label: "V-1", row: "V", number: 1 })
    .returning({ id: schema.seats.id });
  const hold3 = await createHold(db, buyer.id, event.id, [vipSeat.id]);
  await ensurePaymentForBooking(db, hold3.bookingId, hold3.totalAmount);
  await failBookingPayment(db, hold3.bookingId);
  const [b3] = await tdb.select().from(schema.bookings).where(eq(schema.bookings.id, hold3.bookingId));
  ok("failed payment → booking CANCELLED", b3.status === "CANCELLED");
  const [vipAfter] = await tdb.select({ status: schema.seats.status }).from(schema.seats).where(eq(schema.seats.id, vipSeat.id));
  ok("failed payment → seat AVAILABLE", vipAfter.status === "AVAILABLE");

  // ---- 10. late capture: hold expires, then payment.captured arrives ----
  const [tier3] = await tdb
    .insert(schema.ticketTiers)
    .values({ eventId: event.id, name: "Late", price: 10000, capacity: 1 })
    .returning();
  const [lateSeat] = await tdb
    .insert(schema.seats)
    .values({ tierId: tier3.id, label: "L-1", row: "L", number: 1 })
    .returning({ id: schema.seats.id });
  const hold4 = await createHold(db, buyer.id, event.id, [lateSeat.id]);
  const lp = await ensurePaymentForBooking(db, hold4.bookingId, hold4.totalAmount);
  await tdb
    .update(schema.bookings)
    .set({ holdExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.bookings.id, hold4.bookingId));
  const expiredView = await getBookingForUser(db, buyer.id, hold4.bookingId);
  ok("lapsed hold reads EXPIRED", expiredView?.status === "EXPIRED");
  // webhook logic: booking not PENDING → record, don't re-sell
  await recordCapturedPayment(db, hold4.bookingId, "pay_late999");
  const [latePay] = await tdb.select().from(schema.payments).where(eq(schema.payments.id, lp.id));
  ok("late capture recorded CAPTURED", latePay.status === "CAPTURED" && latePay.providerPaymentId === "pay_late999");
  const [lateSeatRow] = await tdb
    .select({ status: schema.seats.status })
    .from(schema.seats)
    .where(eq(schema.seats.id, lateSeat.id));
  ok("late capture does not re-sell released seat", lateSeatRow.status === "AVAILABLE");
  // replay/overwrite safety: never clobber a REFUNDED row
  await tdb.update(schema.payments).set({ status: "REFUNDED" }).where(eq(schema.payments.id, lp.id));
  await recordCapturedPayment(db, hold4.bookingId, "pay_late000");
  const [latePay2] = await tdb.select().from(schema.payments).where(eq(schema.payments.id, lp.id));
  ok(
    "recordCapturedPayment does not overwrite REFUNDED",
    latePay2.status === "REFUNDED" && latePay2.providerPaymentId === "pay_late999"
  );

  console.log(`\nAll ${passed} payment/waitlist tests passed.`);
  await pg.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
