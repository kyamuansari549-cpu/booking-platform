import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { events, users } from "@/db/schema";
import { formatDateTime } from "@/lib/format";

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

  const myEvents = await db
    .select()
    .from(events)
    .where(eq(events.organizerId, session.user.id))
    .orderBy(desc(events.createdAt));

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

      {myEvents.length === 0 ? (
        <p className="mt-12 text-center text-zinc-500">
          No events yet. Create your first one.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {myEvents.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/10 p-5 dark:border-white/10"
            >
              <div>
                <p className="font-semibold">{e.title}</p>
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
                {e.status === "PUBLISHED" ? (
                  <Link href={`/events/${e.id}`} className="text-sm underline">
                    View
                  </Link>
                ) : null}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
