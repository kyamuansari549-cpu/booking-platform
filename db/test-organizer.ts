/**
 * Tests for organizer analytics + operations against PGlite.
 * Covers: event stats (sold/occupancy/revenue), sales-over-time,
 * attendee list, check-in toggle + authorization, organizer refunds.
 * Run: npx tsx db/test-organizer.ts
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { createHold, type Db } from "@/lib/holds";
import {
  confirmBookingPayment,
  ensurePaymentForBooking,
  refundBookingAsOrganizer,
} from "@/lib/payments";
import {
  getAttendees,
  getEventStats,
  getOrganizerEvent,
  getOrganizerOverview,
  getSalesOverTime,
  setCheckedIn,
} from "@/lib/organizer";

const pg = new PGlite();
const tdb = drizzle(pg, { schema });
const db = tdb as unknown as Db;

let passed = 0;
function ok(name: string, cond: boolean) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok: ${name}`);
}

async function confirm(db: Db, bookingId: string, amount: number, tag: string) {
  const p = await ensurePaymentForBooking(db, bookingId, amount);
  await tdb
    .update(schema.payments)
    .set({ providerOrderId: `order_${tag}` })
    .where(eq(schema.payments.id, p.id));
  await confirmBookingPayment(db, bookingId, `pay_${tag}`);
}

async function main() {
  const sql = readFileSync("db/migrations/0000_wet_dorian_gray.sql", "utf8");
  await pg.exec(sql);
  const sql1 = readFileSync("db/migrations/0001_add_checked_in_at.sql", "utf8");
  await pg.exec(sql1);

  const [org] = await tdb
    .insert(schema.users)
    .values({ email: "org@demo", name: "Org", role: "ORGANIZER" })
    .returning();
  const [buyer] = await tdb
    .insert(schema.users)
    .values({ email: "buyer@demo", name: "Buyer" })
    .returning();
  const [stranger] = await tdb
    .insert(schema.users)
    .values({ email: "stranger@demo", name: "Stranger" })
    .returning();
  const [event] = await tdb
    .insert(schema.events)
    .values({
      title: "Org Test Gig",
      description: "d",
      venue: "Hall",
      city: "BLR",
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 90000000),
      status: "PUBLISHED",
      organizerId: org.id,
    })
    .returning();
  const [tierA] = await tdb
    .insert(schema.ticketTiers)
    .values({ eventId: event.id, name: "General", price: 20000, capacity: 3 })
    .returning();
  const [tierB] = await tdb
    .insert(schema.ticketTiers)
    .values({ eventId: event.id, name: "VIP", price: 50000, capacity: 1 })
    .returning();
  const seatRows = await tdb
    .insert(schema.seats)
    .values([
      { tierId: tierA.id, label: "A-1", row: "A", number: 1 },
      { tierId: tierA.id, label: "A-2", row: "A", number: 2 },
      { tierId: tierA.id, label: "A-3", row: "A", number: 3 },
      { tierId: tierB.id, label: "V-1", row: "V", number: 1 },
    ])
    .returning({ id: schema.seats.id });
  const [a1, a2, a3, v1] = seatRows.map((s) => s.id);

  // Two confirmed bookings: buyer takes A-1, A-2; stranger takes V-1.
  const h1 = await createHold(db, buyer.id, event.id, [a1, a2]);
  await confirm(db, h1.bookingId, h1.totalAmount, "t1");
  const h2 = await createHold(db, stranger.id, event.id, [v1]);
  await confirm(db, h2.bookingId, h2.totalAmount, "t2");
  // One pending hold on A-3 (not counted as sold).
  const h3 = await createHold(db, buyer.id, event.id, [a3]);

  // ---- stats ----
  const stats = await getEventStats(db, event.id);
  ok("sold = 3", stats.sold === 3);
  ok("capacity = 4", stats.capacity === 4);
  ok("occupancy 75%", stats.occupancyPct === 75);
  ok("revenue = 2*20000 + 50000", stats.revenue === 90000);
  ok("held = 1", stats.held === 1);
  const gen = stats.tiers.find((t) => t.tierId === tierA.id)!;
  ok("tier General sold=2 held=1 avail=0", gen.sold === 2 && gen.held === 1 && gen.available === 0);
  ok("tier General revenue = 40000", gen.revenue === 40000);
  const vip = stats.tiers.find((t) => t.tierId === tierB.id)!;
  ok("tier VIP sold=1 revenue=50000", vip.sold === 1 && vip.revenue === 50000);

  // ---- sales over time ----
  const sales = await getSalesOverTime(db, event.id, 14);
  ok("14 days returned", sales.length === 14);
  const today = sales[sales.length - 1];
  ok("today has 3 tickets", today.tickets === 3);
  ok("today revenue 90000", today.revenue === 90000);
  ok("other days zero", sales.slice(0, -1).every((d) => d.tickets === 0));

  // ---- attendees ----
  const attendees = await getAttendees(db, event.id);
  ok("2 attendees", attendees.length === 2);
  const buyerRow = attendees.find((a) => a.email === "buyer@demo")!;
  ok(
    "attendee seats aggregated",
    buyerRow.seatLabels.join(",") === "A-1,A-2"
  );
  ok("not checked in yet", buyerRow.checkedInAt === null);

  // ---- check-in ----
  ok("organizer can check in", await setCheckedIn(db, org.id, h1.bookingId, true));
  const [checked] = await tdb
    .select({ at: schema.bookings.checkedInAt })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, h1.bookingId));
  ok("checkedInAt set", checked.at !== null);
  const stats2 = await getEventStats(db, event.id);
  ok("checkedIn counted in stats", stats2.checkedIn === 1);
  ok("organizer can undo check-in", await setCheckedIn(db, org.id, h1.bookingId, false));
  ok("stranger cannot check in", !(await setCheckedIn(db, stranger.id, h1.bookingId, true)));
  ok("cannot check in a PENDING booking", !(await setCheckedIn(db, org.id, h3.bookingId, true)));

  // ---- ownership scoping ----
  ok("organizer loads own event", (await getOrganizerEvent(db, org.id, event.id))?.id === event.id);
  ok("stranger cannot load event", (await getOrganizerEvent(db, stranger.id, event.id)) === null);
  const overview = await getOrganizerOverview(db, org.id);
  ok("overview has 1 event", overview.length === 1);
  ok("overview revenue matches", overview[0].stats.revenue === 90000);

  // ---- organizer refund ----
  let threw = false;
  try {
    await refundBookingAsOrganizer(db, stranger.id, h2.bookingId, async () => "rfnd_x");
  } catch {
    threw = true;
  }
  ok("stranger cannot refund", threw);
  const { refundId } = await refundBookingAsOrganizer(
    db,
    org.id,
    h2.bookingId,
    async (pid, amt) => {
      ok("organizer refund hits provider with full amount", amt === 50000);
      return "rfnd_org1";
    }
  );
  ok("organizer refund returns id", refundId === "rfnd_org1");
  const [refunded] = await tdb
    .select({ status: schema.bookings.status })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, h2.bookingId));
  ok("booking REFUNDED", refunded.status === "REFUNDED");
  const [vSeat] = await tdb
    .select({ status: schema.seats.status })
    .from(schema.seats)
    .where(eq(schema.seats.id, v1));
  ok("seat released", vSeat.status === "AVAILABLE");
  const stats3 = await getEventStats(db, event.id);
  ok("revenue drops after refund", stats3.revenue === 40000);
  ok("sold drops after refund", stats3.sold === 2);

  console.log(`\nAll ${passed} organizer tests passed.`);
  await pg.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
