import Link from "next/link";

const features = [
  {
    title: "Real seat maps",
    body: "Pick exact seats on an interactive map. Holds expire in 10 minutes so no one squats your row.",
  },
  {
    title: "Payments that just work",
    body: "Razorpay checkout with webhook-verified confirmation. Failed payment? Seats auto-release.",
  },
  {
    title: "Waitlists, not FOMO",
    body: "Sold out? Join the waitlist and get first dibs when someone cancels, in fair position order.",
  },
  {
    title: "Organizer dashboard",
    body: "Publish events, design seat maps, track revenue and occupancy in real time.",
  },
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <p className="mb-4 font-mono text-xs uppercase tracking-widest text-zinc-500">
          Event ticketing, done right
        </p>
        <h1 className="mx-auto max-w-2xl text-5xl font-semibold tracking-tight">
          Book the exact seat.
          <br />
          Skip the chaos.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          SeatBook is a full-stack ticketing platform with interactive seat
          maps, timed holds, secure payments, waitlists, and refunds.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/events"
            className="rounded-full bg-zinc-950 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Browse events
          </Link>
          <Link
            href="/organizer"
            className="rounded-full border border-black/15 px-6 py-3 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          >
            Host an event
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-black/10 p-6 dark:border-white/10"
            >
              <h2 className="text-lg font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
