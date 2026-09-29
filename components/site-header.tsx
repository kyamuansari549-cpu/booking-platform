import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export async function SiteHeader() {
  const session = await auth();

  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          SeatBook
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/events"
            className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Events
          </Link>
          {session?.user && (
            <Link
              href="/bookings"
              className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              My bookings
            </Link>
          )}
          {session?.user?.role !== "USER" && session?.user && (
            <Link
              href="/organizer"
              className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Organizer
            </Link>
          )}
        </nav>

        <div>
          {session?.user ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-zinc-600 sm:inline dark:text-zinc-400">
                {session.user.name ?? session.user.email}
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut();
                }}
              >
                <button
                  type="submit"
                  className="rounded-full border border-black/15 px-4 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("google");
              }}
            >
              <button
                type="submit"
                className="rounded-full bg-zinc-950 px-4 py-1.5 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
