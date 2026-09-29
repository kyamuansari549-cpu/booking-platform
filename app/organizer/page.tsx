import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { events, users } from "@/db/schema";
import { formatDateTime, inr } from "@/lib/format";
import { getOrganizerOverview } from "@/lib/organizer";

async function becomeOrganizer() {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  await db
    .update(users)
    .set({ role: "ORGANIZER", updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  revalidatePath("/organizer");
}

async function togglePublish(eventId: string, to: "PUBLISHED" | "DRAFT") {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  await db
    .update(events)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(events.id, eventId), eq(events.organizerId, session.user.id)));
  revalidatePath("/organizer");
}

export default async function OrganizerPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/organizer")}`);
  }

  if (session.user.role === "USER") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">Organizer access</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Organizers can create events, design seat maps, and track sales.
        </p>
        <form action={becomeOrganizer} className="mt-6">
          <button
            type="submit"
            className="rounded-full bg-zinc-950 px-6 py-2.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
          >
            Become an organizer (demo)
          </button>
        </form>
      </div>
    );
  }

  const overview = await getOrganizerOverview(db, session.user.id);
  const totals = overview.reduce(
    (a, o) => ({
      revenue: a.revenue + o.stats.revenue,
      sold: a.sold + o.stats.sold,
    }),
    { revenue: 0, sold: 0 }
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Organizer</h1>
        <Link
          href="/organizer/events/new"
          className="rounded-full bg-zinc-950 px-5 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
        >
          New event
        </Link>
      </div>

      {overview.length > 0 && (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total revenue" value={inr(totals.revenue)} />
          <StatCard label="Tickets sold" value={String(totals.sold)} />
          <StatCard label="Events" value={String(overview.length)} />
          <StatCard
            label="Waitlist"
            value={String(
              overview.reduce((a, o) => a + o.stats.waitlistWaiting, 0)
            )}
          />
        </div>
      )}

      {overview.length === 0 ? (
        <p className="mt-12 text-center text-zinc-500">
          No events yet. Create your first one.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {overview.map(({ event: e, stats }) => (
            <li
              key={e.id}
              className="rounded-2xl border border-black/10 p-5 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <Link
                    href={`/organizer/events/${e.id}`}
                    className="font-semibold hover:underline"
                  >
                    {e.title}
                  </Link>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {formatDateTime(e.startsAt)} · {e.venue}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      e.status === "PUBLISHED"
                        ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
                        : e.status === "DRAFT"
                          ? "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                    }`}
                  >
                    {e.status}
                  </span>
                  <Link
                    href={`/organizer/events/${e.id}`}
                    className="text-sm underline"
                  >
                    Dashboard
                  </Link>
                  <form
                    action={togglePublish.bind(
                      null,
                      e.id,
                      e.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED"
                    )}
                  >
                    <button
                      type="submit"
                      className="rounded-full border border-black/15 px-4 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                    >
                      {e.status === "PUBLISHED" ? "Unpublish" : "Publish"}
                    </button>
                  </form>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <span>
                  <strong className="text-zinc-950 dark:text-zinc-50">{inr(stats.revenue)}</strong>{" "}
                  revenue
                </span>
                <span>
                  <strong className="text-zinc-950 dark:text-zinc-50">{stats.sold}/{stats.capacity}</strong>{" "}
                  sold ({stats.occupancyPct}%)
                </span>
                {stats.held > 0 && (
                  <span>
                    <strong className="text-zinc-950 dark:text-zinc-50">{stats.held}</strong>{" "}
                    on hold
                  </span>
                )}
                {stats.waitlistWaiting > 0 && (
                  <span>
                    <strong className="text-zinc-950 dark:text-zinc-50">{stats.waitlistWaiting}</strong>{" "}
                    on waitlist
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
