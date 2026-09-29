/**
 * End-to-end test of the seat-hold logic against PGlite (in-process Postgres).
 * Run: npx tsx db/test-holds.ts
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import {
  createHold,
  releaseHold,
  getBookingForUser,
  SeatUnavailableError,
  type Db,
} from "@/lib/holds";

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

async function main() {
  // Apply migrations in order.
  const sql = readFileSync("db/migrations/0000_wet_dorian_gray.sql", "utf8");
  await pg.exec(sql);
  const sql1 = readFileSync("db/migrations/0001_add_checked_in_at.sql", "utf8");
  await pg.exec(sql1);

  const [user] = await tdb
    .insert(schema.users)
    .values({ email: "test@seatbook.demo", name: "Tester" })
    .returning();
  const [user2] = await tdb
    .insert(schema.users)
    .values({ email: "test2@seatbook.demo", name: "Tester 2" })
    .returning();
  const [event] = await tdb
    .insert(schema.events)
    .values({
      title: "Test Gig",
      description: "desc",
      venue: "Hall",
      city: "BLR",
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 90000000),
      status: "PUBLISHED",
      organizerId: user.id,
    })
    .returning();
  const [tier] = await tdb
    .insert(schema.ticketTiers)
    .values({ eventId: event.id, name: "General", price: 10000, capacity: 4 })
    .returning();
  const seatRows = await tdb
    .insert(schema.seats)
    .values(
      ["A-1", "A-2", "A-3", "A-4"].map((label, i) => ({
        tierId: tier.id,
        label,
        row: "A",
        number: i + 1,
      }))
    )
    .returning({ id: schema.seats.id });
  const [s1, s2, s3, s4] = seatRows.map((s) => s.id);

  // A: hold 2 seats
  const hold = await createHold(db, user.id, event.id, [s1, s2]);
  ok("hold returns booking id", !!hold.bookingId);
  ok("hold total = 2 x 10000", hold.totalAmount === 20000);
  const heldSeats = await tdb
    .select()
    .from(schema.seats)
    .where(eq(schema.seats.tierId, tier.id));
  ok(
    "held seats marked HELD",
    heldSeats.filter((s) => s.status === "HELD").length === 2
  );

  // B: overlapping hold fails with 409-style error
  let threw = false;
  try {
    await createHold(db, user2.id, event.id, [s2, s3]);
  } catch (e) {
    threw = e instanceof SeatUnavailableError;
  }
  ok("overlapping hold raises SeatUnavailableError", threw);

  // B2: non-overlapping hold succeeds
  const hold2 = await createHold(db, user2.id, event.id, [s3, s4]);
  ok("non-overlapping hold succeeds", !!hold2.bookingId);

  // C: release returns seats
  const released = await releaseHold(db, user.id, hold.bookingId);
  ok("release returns true", released);
  const afterRelease = await tdb
    .select({ status: schema.seats.status })
    .from(schema.seats)
    .where(eq(schema.seats.id, s1));
  ok("released seat AVAILABLE", afterRelease[0].status === "AVAILABLE");

  // C2: cannot release someone else's booking
  const notReleased = await releaseHold(db, user.id, hold2.bookingId);
  ok("cannot release another user's booking", notReleased === false);

  // D: expiry — backdate the hold, then read the booking
  await tdb
    .update(schema.bookings)
    .set({ holdExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.bookings.id, hold2.bookingId));
  const detail = await getBookingForUser(db, user2.id, hold2.bookingId);
  ok("expired hold reads as EXPIRED", detail?.status === "EXPIRED");
  const afterExpiry = await tdb
    .select({ status: schema.seats.status })
    .from(schema.seats)
    .where(eq(schema.seats.id, s3));
  ok("expired seat AVAILABLE", afterExpiry[0].status === "AVAILABLE");
  ok("detail carries seat labels", (detail?.seats.length ?? 0) === 2);

  // E: race — 5 concurrent holds for the same seat, exactly one wins
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      createHold(db, i % 2 === 0 ? user.id : user2.id, event.id, [s1])
    )
  );
  const wins = results.filter((r) => r.status === "fulfilled").length;
  ok("exactly one racer wins the seat", wins === 1);

  console.log(`\nAll ${passed} hold-logic tests passed.`);
  await pg.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
