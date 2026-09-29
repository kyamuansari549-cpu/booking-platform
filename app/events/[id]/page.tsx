import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { events, seats, ticketTiers } from "@/db/schema";
import { expireStaleHolds } from "@/lib/holds";
import { formatDateTime, inr } from "@/lib/format";
import { SeatMap } from "@/components/seat-map";

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();

  // Release lapsed holds so the map never shows stale HELD seats.
  await expireStaleHolds(db);

  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, id))
    .limit(1);
  if (!event) notFound();
  if (
    event.status !== "PUBLISHED" &&
    (!session?.user || session.user.id !== event.organizerId)
  ) {
    notFound();
  }

  const tiers = await db
    .select()
    .from(ticketTiers)
    .where(eq(ticketTiers.eventId, event.id))
    .orderBy(asc(ticketTiers.price));

  // Fetch seats per tier (kept as separate queries for clarity).
  const tiersWithSeats = await Promise.all(
    tiers.map(async (t) => {
      const s = await db
        .select({
          id: seats.id,
          label: seats.label,
          row: seats.row,
          number: seats.number,
          status: seats.status,
        })
        .from(seats)
        .where(eq(seats.tierId, t.id))
        .orderBy(asc(seats.row), asc(seats.number));
      return {
        id: t.id,
        name: t.name,
        price: t.price,
        seats: s,
      };
    })
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
        {event.city} · {event.venue}
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        {event.title}
      </h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        {formatDateTime(event.startsAt)}
      </p>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {event.description}
      </p>

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        {tiers.map((t) => (
          <span
            key={t.id}
            className="rounded-full border border-black/15 px-3 py-1 dark:border-white/15"
          >
            {t.name} · {inr(t.price)}
          </span>
        ))}
      </div>

      <div className="mt-10">
        <h2 className="text-xl font-semibold">Choose your seats</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Seats are held for 10 minutes once you continue. Sign in is required
          to hold.
        </p>
        <SeatMap
          eventId={event.id}
          tiers={tiersWithSeats}
          signedIn={!!session?.user}
        />
      </div>
    </div>
  );
}
