import { and, eq, inArray, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { bookings, bookingSeats, events, seats, ticketTiers } from "@/db/schema";
import type * as schema from "@/db/schema";
import { redis } from "./redis";

export type Db = PostgresJsDatabase<typeof schema>;

/** How long a seat hold lasts before it auto-expires. */
export const HOLD_TTL_SECONDS = 600;
export const MAX_SEATS_PER_BOOKING = 10;

export class SeatUnavailableError extends Error {
  constructor(message = "Some seats are no longer available") {
    super(message);
    this.name = "SeatUnavailableError";
  }
}

function seatLockKey(seatId: string) {
  return `seatlock:${seatId}`;
}

/**
 * Atomically hold seats for a user.
 *
 * Correctness comes from the DB transaction (SELECT … FOR UPDATE on the
 * seat rows). Redis is a best-effort fast-fail pre-check so two users
 * racing for the same seat get an instant 409 instead of waiting on the
 * row lock.
 */
export async function createHold(
  db: Db,
  userId: string,
  eventId: string,
  seatIds: string[]
) {
  const uniqueIds = [...new Set(seatIds)];
  if (uniqueIds.length === 0) throw new Error("No seats selected");
  if (uniqueIds.length > MAX_SEATS_PER_BOOKING) {
    throw new Error(`Max ${MAX_SEATS_PER_BOOKING} seats per booking`);
  }

  if (redis) {
    try {
      const hits = await redis.mget<(string | null)[]>(
        ...uniqueIds.map(seatLockKey)
      );
      if (hits.some((h) => h !== null)) throw new SeatUnavailableError();
    } catch (e) {
      if (e instanceof SeatUnavailableError) throw e;
      // Redis unavailable — the DB transaction below is the backstop.
    }
  }

  const hold = await db.transaction(async (tx) => {
    // Lock the seat rows; only AVAILABLE ones come back.
    const rows = await tx
      .select({
        id: seats.id,
        price: ticketTiers.price,
        eventId: ticketTiers.eventId,
      })
      .from(seats)
      .innerJoin(ticketTiers, eq(seats.tierId, ticketTiers.id))
      .where(and(inArray(seats.id, uniqueIds), eq(seats.status, "AVAILABLE")))
      .for("update");

    if (rows.length !== uniqueIds.length) throw new SeatUnavailableError();
    if (rows.some((r) => r.eventId !== eventId)) {
      throw new Error("Seats do not belong to this event");
    }

    const totalAmount = rows.reduce((sum, r) => sum + r.price, 0);
    const holdExpiresAt = new Date(Date.now() + HOLD_TTL_SECONDS * 1000);

    const [booking] = await tx
      .insert(bookings)
      .values({ userId, eventId, totalAmount, holdExpiresAt })
      .returning({ id: bookings.id });

    await tx
      .update(seats)
      .set({ status: "HELD" })
      .where(inArray(seats.id, uniqueIds));

    await tx
      .insert(bookingSeats)
      .values(uniqueIds.map((seatId) => ({ bookingId: booking.id, seatId })));

    return { bookingId: booking.id, totalAmount, holdExpiresAt };
  });

  if (redis) {
    try {
      const pipe = redis.pipeline();
      for (const seatId of uniqueIds) {
        pipe.set(seatLockKey(seatId), hold.bookingId, {
          nx: true,
          ex: HOLD_TTL_SECONDS,
        });
      }
      await pipe.exec();
    } catch {
      // best effort
    }
  }

  return hold;
}

/** Release a PENDING hold back to AVAILABLE (user cancel). */
export async function releaseHold(db: Db, userId: string, bookingId: string) {
  const released = await db.transaction(async (tx) => {
    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.userId, userId),
          eq(bookings.status, "PENDING")
        )
      )
      .for("update");
    if (!booking) return false;

    const links = await tx
      .select({ seatId: bookingSeats.seatId })
      .from(bookingSeats)
      .where(eq(bookingSeats.bookingId, booking.id));
    const seatIds = links.map((l) => l.seatId);

    if (seatIds.length > 0) {
      await tx
        .update(seats)
        .set({ status: "AVAILABLE" })
        .where(inArray(seats.id, seatIds));
    }
    await tx
      .update(bookings)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(bookings.id, booking.id));

    if (redis && seatIds.length > 0) {
      try {
        await redis.del(...seatIds.map(seatLockKey));
      } catch {
        // best effort
      }
    }
    return true;
  });

  return released;
}

async function expireBooking(db: Db, bookingId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const links = await t
      .select({ seatId: bookingSeats.seatId })
      .from(bookingSeats)
      .where(eq(bookingSeats.bookingId, bookingId));
    const seatIds = links.map((l) => l.seatId);
    if (seatIds.length > 0) {
      await t
        .update(seats)
        .set({ status: "AVAILABLE" })
        .where(and(inArray(seats.id, seatIds), eq(seats.status, "HELD")));
    }
    await t
      .update(bookings)
      .set({ status: "EXPIRED", updatedAt: new Date() })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "PENDING")));
  });
}

/**
 * Expire every PENDING booking whose hold lapsed. Idempotent — safe to call
 * on every page load and from the cron route.
 */
export async function expireStaleHolds(db: Db): Promise<number> {
  const stale = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(eq(bookings.status, "PENDING"), lt(bookings.holdExpiresAt, new Date()))
    );

  for (const b of stale) {
    await expireBooking(db, b.id);
  }
  return stale.length;
}

export type BookingDetail = {
  id: string;
  eventId: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "REFUNDED" | "EXPIRED";
  totalAmount: number;
  holdExpiresAt: Date | null;
  eventTitle: string;
  seats: { id: string; label: string; tierName: string; price: number }[];
};

/**
 * Fetch a booking for its owner. Lazily expires it first if the hold lapsed,
 * so callers always see the true status.
 */
export async function getBookingForUser(
  db: Db,
  userId: string,
  bookingId: string
): Promise<BookingDetail | null> {
  await expireStaleHolds(db);

  const rows = await db
    .select({
      bookingId: bookings.id,
      eventId: bookings.eventId,
      status: bookings.status,
      totalAmount: bookings.totalAmount,
      holdExpiresAt: bookings.holdExpiresAt,
      eventTitle: events.title,
      seatId: seats.id,
      seatLabel: seats.label,
      tierName: ticketTiers.name,
      price: ticketTiers.price,
    })
    .from(bookings)
    .innerJoin(events, eq(bookings.eventId, events.id))
    .leftJoin(bookingSeats, eq(bookingSeats.bookingId, bookings.id))
    .leftJoin(seats, eq(seats.id, bookingSeats.seatId))
    .leftJoin(ticketTiers, eq(ticketTiers.id, seats.tierId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)));

  if (rows.length === 0) return null;
  const head = rows[0];
  return {
    id: head.bookingId,
    eventId: head.eventId,
    status: head.status,
    totalAmount: head.totalAmount,
    holdExpiresAt: head.holdExpiresAt,
    eventTitle: head.eventTitle,
    seats: rows
      .filter((r) => r.seatId !== null)
      .map((r) => ({
        id: r.seatId as string,
        label: r.seatLabel as string,
        tierName: (r.tierName ?? "") as string,
        price: (r.price ?? 0) as number,
      })),
  };
}
