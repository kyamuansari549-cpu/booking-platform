import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  bookings,
  bookingSeats,
  events,
  payments,
  seats,
  ticketTiers,
  users,
  waitlistEntries,
} from "@/db/schema";
import type { Db } from "./holds";

/** Load an event only if it belongs to the organizer, else null. */
export async function getOrganizerEvent(
  db: Db,
  organizerId: string,
  eventId: string
) {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizerId, organizerId)))
    .limit(1);
  return event ?? null;
}

export type TierStat = {
  tierId: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  held: number;
  available: number;
  revenue: number; // paise, from CAPTURED payments' bookings in this tier
};

export type EventStats = {
  sold: number;
  capacity: number;
  occupancyPct: number;
  revenue: number; // paise
  held: number;
  checkedIn: number;
  waitlistWaiting: number;
  waitlistOffered: number;
  tiers: TierStat[];
};

export async function getEventStats(db: Db, eventId: string): Promise<EventStats> {
  const tiers = await db
    .select()
    .from(ticketTiers)
    .where(eq(ticketTiers.eventId, eventId));

  // Seat counts per tier per status.
  const seatCounts = await db
    .select({
      tierId: seats.tierId,
      status: seats.status,
      n: count(),
    })
    .from(seats)
    .innerJoin(ticketTiers, eq(ticketTiers.id, seats.tierId))
    .where(eq(ticketTiers.eventId, eventId))
    .groupBy(seats.tierId, seats.status);

  // Revenue per tier: sum of tier price over every seat in a CONFIRMED
  // booking. Exact, since each seat row contributes its own tier's price.
  const tierRevenue = await db
    .select({
      tierId: seats.tierId,
      revenue: sql<number>`coalesce(sum(${ticketTiers.price}), 0)`,
    })
    .from(bookingSeats)
    .innerJoin(seats, eq(seats.id, bookingSeats.seatId))
    .innerJoin(ticketTiers, eq(ticketTiers.id, seats.tierId))
    .innerJoin(bookings, eq(bookings.id, bookingSeats.bookingId))
    .where(
      and(
        eq(bookings.eventId, eventId),
        eq(bookings.status, "CONFIRMED")
      )
    )
    .groupBy(seats.tierId);

  const revByTier = new Map(tierRevenue.map((r) => [r.tierId, r]));

  const tierStats: TierStat[] = tiers.map((t) => {
    const forTier = (s: string) =>
      seatCounts.find((c) => c.tierId === t.id && c.status === s)?.n ?? 0;
    const rev = revByTier.get(t.id);
    return {
      tierId: t.id,
      name: t.name,
      price: t.price,
      capacity: forTier("AVAILABLE") + forTier("HELD") + forTier("SOLD"),
      sold: forTier("SOLD"),
      held: forTier("HELD"),
      available: forTier("AVAILABLE"),
      revenue: Number(rev?.revenue ?? 0),
    };
  });

  const [revRow] = await db
    .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(
      and(
        eq(bookings.eventId, eventId),
        eq(payments.status, "CAPTURED")
      )
    );

  const [checkedInRow] = await db
    .select({ n: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.eventId, eventId),
        eq(bookings.status, "CONFIRMED"),
        isNotNull(bookings.checkedInAt)
      )
    );

  const waitlistCounts = await db
    .select({ status: waitlistEntries.status, n: count() })
    .from(waitlistEntries)
    .where(eq(waitlistEntries.eventId, eventId))
    .groupBy(waitlistEntries.status);

  const sold = tierStats.reduce((a, t) => a + t.sold, 0);
  const capacity = tierStats.reduce((a, t) => a + t.capacity, 0);

  return {
    sold,
    capacity,
    occupancyPct: capacity === 0 ? 0 : Math.round((sold / capacity) * 100),
    revenue: Number(revRow?.total ?? 0),
    held: tierStats.reduce((a, t) => a + t.held, 0),
    checkedIn: checkedInRow?.n ?? 0,
    waitlistWaiting:
      waitlistCounts.find((w) => w.status === "WAITING")?.n ?? 0,
    waitlistOffered:
      waitlistCounts.find((w) => w.status === "OFFERED")?.n ?? 0,
    tiers: tierStats,
  };
}

export type DaySales = { date: string; tickets: number; revenue: number };

/** Tickets sold + revenue per day for the last `days` days. */
export async function getSalesOverTime(
  db: Db,
  eventId: string,
  days = 14
): Promise<DaySales[]> {
  const since = new Date(Date.now() - days * 86400000);
  const dayExpr = sql`date_trunc('day', ${bookings.createdAt})`;

  // Tickets per day (join seats — one row per seat).
  const ticketRows = await db
    .select({
      day: sql<string>`${dayExpr}::date::text`,
      tickets: sql<number>`count(${bookingSeats.seatId})`,
    })
    .from(bookings)
    .innerJoin(bookingSeats, eq(bookingSeats.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.eventId, eventId),
        eq(bookings.status, "CONFIRMED"),
        gte(bookings.createdAt, since)
      )
    )
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  // Revenue per day (bookings only — joining seats would double-count totals).
  const revenueRows = await db
    .select({
      day: sql<string>`${dayExpr}::date::text`,
      revenue: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.eventId, eventId),
        eq(bookings.status, "CONFIRMED"),
        gte(bookings.createdAt, since)
      )
    )
    .groupBy(dayExpr);

  const ticketsByDay = new Map(ticketRows.map((r) => [r.day, Number(r.tickets)]));
  const revenueByDay = new Map(revenueRows.map((r) => [r.day, Number(r.revenue)]));
  const out: DaySales[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    out.push({
      date: key,
      tickets: ticketsByDay.get(key) ?? 0,
      revenue: revenueByDay.get(key) ?? 0,
    });
  }
  return out;
}

export type Attendee = {
  bookingId: string;
  name: string | null;
  email: string;
  seatLabels: string[];
  totalAmount: number;
  checkedInAt: Date | null;
  createdAt: Date;
};

export async function getAttendees(db: Db, eventId: string): Promise<Attendee[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      name: users.name,
      email: users.email,
      totalAmount: bookings.totalAmount,
      checkedInAt: bookings.checkedInAt,
      createdAt: bookings.createdAt,
      seatLabels: sql<string[]>`array_agg(${seats.label} order by ${seats.label})`,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.userId))
    .innerJoin(bookingSeats, eq(bookingSeats.bookingId, bookings.id))
    .innerJoin(seats, eq(seats.id, bookingSeats.seatId))
    .where(
      and(eq(bookings.eventId, eventId), eq(bookings.status, "CONFIRMED"))
    )
    .groupBy(
      bookings.id,
      users.name,
      users.email,
      bookings.totalAmount,
      bookings.checkedInAt,
      bookings.createdAt
    )
    .orderBy(desc(bookings.createdAt));

  return rows.map((r) => ({ ...r, seatLabels: r.seatLabels ?? [] }));
}

/** Toggle check-in for a CONFIRMED booking on the organizer's event. */
export async function setCheckedIn(
  db: Db,
  organizerId: string,
  bookingId: string,
  checkedIn: boolean
): Promise<boolean> {
  const [row] = await db
    .select({ organizerId: events.organizerId })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .where(
      and(eq(bookings.id, bookingId), eq(bookings.status, "CONFIRMED"))
    )
    .limit(1);
  if (!row || row.organizerId !== organizerId) return false;

  await db
    .update(bookings)
    .set({ checkedInAt: checkedIn ? new Date() : null, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId));
  return true;
}

/** Per-event rollup for the organizer overview page. */
export async function getOrganizerOverview(db: Db, organizerId: string) {
  const owned = await db
    .select()
    .from(events)
    .where(eq(events.organizerId, organizerId))
    .orderBy(desc(events.createdAt));

  return Promise.all(
    owned.map(async (e) => ({ event: e, stats: await getEventStats(db, e.id) }))
  );
}
