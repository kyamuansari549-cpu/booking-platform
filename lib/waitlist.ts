import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { events, ticketTiers, waitlistEntries } from "@/db/schema";
import type { Db } from "./holds";

/** Offer window: how long an offered waitlist entry stays claimable. */
export const OFFER_TTL_HOURS = 24;

export type WaitlistEntryView = {
  id: string;
  eventId: string;
  eventTitle: string;
  tierId: string | null;
  tierName: string | null;
  seatsWanted: number;
  position: number;
  status: "WAITING" | "OFFERED" | "ACCEPTED" | "EXPIRED";
  offeredAt: Date | null;
};

/** Join the waitlist for an event (optionally a specific tier). */
export async function joinWaitlist(
  db: Db,
  userId: string,
  eventId: string,
  tierId: string | null,
  seatsWanted = 1
) {
  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.status, "PUBLISHED")))
    .limit(1);
  if (!event) throw new Error("Event not found or not on sale");

  if (tierId) {
    const [tier] = await db
      .select({ id: ticketTiers.id })
      .from(ticketTiers)
      .where(and(eq(ticketTiers.id, tierId), eq(ticketTiers.eventId, eventId)))
      .limit(1);
    if (!tier) throw new Error("Tier not found");
  }

  const existing = await db
    .select({ id: waitlistEntries.id })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.userId, userId),
        eq(waitlistEntries.eventId, eventId),
        tierId
          ? eq(waitlistEntries.tierId, tierId)
          : isNull(waitlistEntries.tierId),
        or(
          eq(waitlistEntries.status, "WAITING"),
          eq(waitlistEntries.status, "OFFERED")
        )
      )
    )
    .limit(1);
  if (existing.length > 0) throw new Error("Already on the waitlist");

  // Clear any terminal (EXPIRED/ACCEPTED) entries so the user can rejoin
  // without tripping the per-user/event/tier unique constraint.
  await db
    .delete(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.userId, userId),
        eq(waitlistEntries.eventId, eventId),
        tierId
          ? eq(waitlistEntries.tierId, tierId)
          : isNull(waitlistEntries.tierId),
        or(
          eq(waitlistEntries.status, "EXPIRED"),
          eq(waitlistEntries.status, "ACCEPTED")
        )
      )
    );

  const [maxRow] = await db
    .select({ max: sql<number | null>`max(${waitlistEntries.position})` })
    .from(waitlistEntries)
    .where(eq(waitlistEntries.eventId, eventId));
  const position = (maxRow?.max ?? 0) + 1;

  const [entry] = await db
    .insert(waitlistEntries)
    .values({ userId, eventId, tierId, seatsWanted, position })
    .returning({ id: waitlistEntries.id, position: waitlistEntries.position });
  return entry;
}

export async function leaveWaitlist(db: Db, userId: string, entryId: string) {
  const res = await db
    .delete(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.id, entryId),
        eq(waitlistEntries.userId, userId),
        or(
          eq(waitlistEntries.status, "WAITING"),
          eq(waitlistEntries.status, "OFFERED")
        )
      )
    )
    .returning({ id: waitlistEntries.id });
  return res.length > 0;
}

/**
 * Offer freed seats to the earliest waiting entry for the event/tier.
 * Entries with tierId NULL match any tier. Idempotent per call.
 */
export async function fulfillWaitlist(
  db: Db,
  eventId: string,
  tierId: string
): Promise<string | null> {
  const [next] = await db
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.eventId, eventId),
        eq(waitlistEntries.status, "WAITING"),
        or(eq(waitlistEntries.tierId, tierId), isNull(waitlistEntries.tierId))
      )
    )
    .orderBy(asc(waitlistEntries.position))
    .limit(1);

  if (!next) return null;

  await db
    .update(waitlistEntries)
    .set({ status: "OFFERED", offeredAt: new Date() })
    .where(
      and(
        eq(waitlistEntries.id, next.id),
        eq(waitlistEntries.status, "WAITING")
      )
    );
  return next.id;
}

/** Expire offers older than OFFER_TTL_HOURS, cascading to the next in line. */
export async function expireStaleOffers(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - OFFER_TTL_HOURS * 3600 * 1000);
  const stale = await db
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.status, "OFFERED"),
        lt(waitlistEntries.offeredAt, cutoff)
      )
    );

  for (const entry of stale) {
    await db
      .update(waitlistEntries)
      .set({ status: "EXPIRED" })
      .where(
        and(
          eq(waitlistEntries.id, entry.id),
          eq(waitlistEntries.status, "OFFERED")
        )
      );
    // entry.tierId may be null → fulfill against every tier with availability;
    // callers pass the tier that freed up, so null-tier offers re-fulfill
    // on the next freed seat. Keep it simple: skip cascade for null tiers.
    if (entry.tierId) {
      await fulfillWaitlist(db, entry.eventId, entry.tierId);
    }
  }
  return stale.length;
}

/** When a user with an OFFERED entry successfully holds seats, accept it. */
export async function acceptWaitlistOffer(
  db: Db,
  userId: string,
  eventId: string
): Promise<void> {
  await db
    .update(waitlistEntries)
    .set({ status: "ACCEPTED" })
    .where(
      and(
        eq(waitlistEntries.userId, userId),
        eq(waitlistEntries.eventId, eventId),
        eq(waitlistEntries.status, "OFFERED")
      )
    );
}

export async function getUserWaitlist(
  db: Db,
  userId: string
): Promise<WaitlistEntryView[]> {
  const rows = await db
    .select({
      id: waitlistEntries.id,
      eventId: waitlistEntries.eventId,
      eventTitle: events.title,
      tierId: waitlistEntries.tierId,
      tierName: ticketTiers.name,
      seatsWanted: waitlistEntries.seatsWanted,
      position: waitlistEntries.position,
      status: waitlistEntries.status,
      offeredAt: waitlistEntries.offeredAt,
    })
    .from(waitlistEntries)
    .innerJoin(events, eq(events.id, waitlistEntries.eventId))
    .leftJoin(ticketTiers, eq(ticketTiers.id, waitlistEntries.tierId))
    .where(eq(waitlistEntries.userId, userId))
    .orderBy(asc(waitlistEntries.position));
  return rows as WaitlistEntryView[];
}
