import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { bookings, events } from "@/db/schema";
import { inr, formatDateTime } from "@/lib/format";
import { getUserWaitlist } from "@/lib/waitlist";
import { CancelBookingButton } from "@/components/cancel-booking-button";
import { LeaveWaitlistButton } from "@/components/waitlist-buttons";

const badge: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  CONFIRMED: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
  CANCELLED: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  REFUNDED: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  EXPIRED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

export default async function BookingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/bookings")}`);
  }

  const rows = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      totalAmount: bookings.totalAmount,
      createdAt: bookings.createdAt,
      holdExpiresAt: bookings.holdExpiresAt,
      eventTitle: events.title,
      startsAt: events.startsAt,
    })
    .from(bookings)
    .innerJoin(events, eq(bookings.eventId, events.id))
    .where(eq(bookings.userId, session.user.id))
    .orderBy(desc(bookings.createdAt));

  const waitlist = (await getUserWaitlist(db, session.user.id)).filter(
    (w) => w.status === "WAITING" || w.status === "OFFERED"
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">My bookings</h1>

      {rows.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-zinc-500">No bookings yet.</p>
          <Link
            href="/events"
            className="mt-4 inline-block rounded-full bg-zinc-950 px-6 py-2.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
          >
            Browse events
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/10 p-5 dark:border-white/10"
            >
              <div>
                <p className="font-semibold">{b.eventTitle}</p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {formatDateTime(b.startsAt)} · {inr(b.totalAmount)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${badge[b.status]}`}
                >
                  {b.status}
                </span>
                {b.status === "PENDING" && (
                  <Link
                    href={`/checkout/${b.id}`}
                    className="rounded-full border border-black/15 px-4 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                  >
                    Continue
                  </Link>
                )}
                {(b.status === "PENDING" || b.status === "CONFIRMED") && (
                  <CancelBookingButton bookingId={b.id} status={b.status} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {waitlist.length > 0 && (
        <div className="mt-12">
          <h2 className="text-xl font-semibold">My waitlist</h2>
          <ul className="mt-4 space-y-3">
            {waitlist.map((w) => (
              <li
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 p-4 dark:border-white/10"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {w.eventTitle}
                    {w.tierName && (
                      <span className="font-normal text-zinc-500"> · {w.tierName}</span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {w.status === "OFFERED" ? (
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">
                        Seats opened up for you — offer expires 24h after it was made
                      </span>
                    ) : (
                      <>Position #{w.position} in line</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {w.status === "OFFERED" && (
                    <Link
                      href={`/events/${w.eventId}`}
                      className="rounded-full bg-zinc-950 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
                    >
                      Book now
                    </Link>
                  )}
                  <LeaveWaitlistButton entryId={w.id} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
