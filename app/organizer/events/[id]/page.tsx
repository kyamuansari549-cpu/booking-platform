import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { formatDateTime, inr } from "@/lib/format";
import {
  getAttendees,
  getEventStats,
  getOrganizerEvent,
  getSalesOverTime,
} from "@/lib/organizer";
import {
  CheckinButton,
  OrganizerRefundButton,
} from "@/components/organizer-actions";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

/** Dependency-free SVG bar chart of tickets sold per day. */
function SalesChart({ data }: { data: { date: string; tickets: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.tickets));
  const W = 560;
  const H = 140;
  const barW = W / data.length;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Tickets sold per day"
    >
      {data.map((d, i) => {
        const h = Math.max(2, (d.tickets / max) * (H - 24));
        return (
          <g key={d.date}>
            <rect
              x={i * barW + 2}
              y={H - 18 - h}
              width={Math.max(1, barW - 4)}
              height={h}
              rx={2}
              className="fill-zinc-900 dark:fill-zinc-100"
              opacity={d.tickets === 0 ? 0.15 : 0.85}
            >
              <title>
                {d.date}: {d.tickets} ticket{d.tickets === 1 ? "" : "s"}
              </title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

export default async function OrganizerEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/organizer/events/${id}`)}`);
  }

  const event = await getOrganizerEvent(db, session.user.id, id);
  if (!event) notFound();

  const [stats, sales, attendees] = await Promise.all([
    getEventStats(db, event.id),
    getSalesOverTime(db, event.id),
    getAttendees(db, event.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/organizer" className="text-sm text-zinc-500 hover:underline">
        ← All events
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{event.title}</h1>
        <Link
          href={`/events/${event.id}`}
          className="text-sm underline"
          target="_blank"
        >
          View public page
        </Link>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {formatDateTime(event.startsAt)} · {event.venue}, {event.city} ·{" "}
        {event.status}
      </p>

      {/* Stat cards */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Revenue" value={inr(stats.revenue)} />
        <StatCard label="Tickets sold" value={`${stats.sold}/${stats.capacity}`} />
        <StatCard label="Occupancy" value={`${stats.occupancyPct}%`} />
        <StatCard label="Checked in" value={`${stats.checkedIn}/${stats.sold}`} />
        <StatCard label="On hold" value={String(stats.held)} />
        <StatCard
          label="Waitlist"
          value={`${stats.waitlistWaiting} waiting`}
        />
      </div>

      {/* Per-tier breakdown */}
      <h2 className="mt-12 text-xl font-semibold">Tiers</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wider text-zinc-500 dark:border-white/10">
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Sold</th>
              <th className="px-4 py-3">Held</th>
              <th className="px-4 py-3">Available</th>
              <th className="px-4 py-3">Revenue</th>
              <th className="px-4 py-3">Occupancy</th>
            </tr>
          </thead>
          <tbody>
            {stats.tiers.map((t) => {
              const cap = t.sold + t.held + t.available;
              const pct = cap === 0 ? 0 : Math.round((t.sold / cap) * 100);
              return (
                <tr
                  key={t.tierId}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3">{inr(t.price)}</td>
                  <td className="px-4 py-3">{t.sold}</td>
                  <td className="px-4 py-3">{t.held}</td>
                  <td className="px-4 py-3">{t.available}</td>
                  <td className="px-4 py-3">{inr(t.revenue)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-zinc-500">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sales over time */}
      <h2 className="mt-12 text-xl font-semibold">Sales — last 14 days</h2>
      <div className="mt-4 rounded-2xl border border-black/10 p-4 dark:border-white/10">
        {sales.every((s) => s.tickets === 0) ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            No sales in the last 14 days.
          </p>
        ) : (
          <SalesChart data={sales} />
        )}
      </div>

      {/* Attendees */}
      <h2 className="mt-12 text-xl font-semibold">
        Attendees{" "}
        <span className="font-normal text-zinc-500">({attendees.length})</span>
      </h2>
      {attendees.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No confirmed bookings yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wider text-zinc-500 dark:border-white/10">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Seats</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Check-in</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {attendees.map((a) => (
                <tr
                  key={a.bookingId}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  <td className="px-4 py-3 font-medium">{a.name ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {a.email}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {a.seatLabels.join(", ")}
                  </td>
                  <td className="px-4 py-3">{inr(a.totalAmount)}</td>
                  <td className="px-4 py-3">
                    <CheckinButton
                      bookingId={a.bookingId}
                      checkedIn={!!a.checkedInAt}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <OrganizerRefundButton bookingId={a.bookingId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
