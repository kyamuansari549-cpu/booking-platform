import Link from "next/link";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { events, ticketTiers } from "@/db/schema";
import { inr, formatDateTime } from "@/lib/format";

export const metadata = { title: "Events — SeatBook" };

export default async function EventsPage() {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(eq(events.status, "PUBLISHED"), gte(events.startsAt, new Date()))
    )
    .orderBy(asc(events.startsAt));

  const tiers =
    rows.length > 0
      ? await db
          .select({
            eventId: ticketTiers.eventId,
            price: ticketTiers.price,
          })
          .from(ticketTiers)
      : [];
  const minPrice = new Map<string, number>();
  for (const t of tiers) {
    const cur = minPrice.get(t.eventId);
    if (cur === undefined || t.price < cur) minPrice.set(t.eventId, t.price);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Upcoming events</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Pick an event, choose your exact seats, pay securely.
      </p>

      {rows.length === 0 ? (
        <p className="mt-12 text-center text-zinc-500">
          No events on sale right now. Check back soon.
        </p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((e) => (
            <Link
              key={e.id}
              href={`/events/${e.id}`}
              className="group rounded-2xl border border-black/10 p-6 transition hover:border-black/25 dark:border-white/10 dark:hover:border-white/25"
            >
              <h2 className="text-lg font-semibold group-hover:underline">
                {e.title}
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {e.venue} · {e.city}
              </p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {formatDateTime(e.startsAt)}
              </p>
              <p className="mt-4 text-sm font-medium">
                {minPrice.has(e.id) ? (
                  <>From {inr(minPrice.get(e.id)!)}</>
                ) : (
                  <span className="text-zinc-500">Prices TBA</span>
                )}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
