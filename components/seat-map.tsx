"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { inr } from "@/lib/format";
import { MAX_SEATS_PER_BOOKING } from "@/lib/holds";

type Seat = {
  id: string;
  label: string;
  row: string;
  number: number;
  status: "AVAILABLE" | "HELD" | "SOLD";
};

type Tier = {
  id: string;
  name: string;
  price: number;
  seats: Seat[];
};

function seatClass(status: Seat["status"], selected: boolean) {
  if (selected)
    return "bg-zinc-950 text-white border-zinc-950 dark:bg-zinc-50 dark:text-zinc-950 dark:border-zinc-50";
  if (status === "AVAILABLE")
    return "border-black/20 hover:border-zinc-950 hover:bg-black/5 dark:border-white/20 dark:hover:border-zinc-50 dark:hover:bg-white/10 cursor-pointer";
  return "border-black/10 text-zinc-400 cursor-not-allowed dark:border-white/10 dark:text-zinc-600";
}

import { JoinWaitlistButton } from "./waitlist-buttons";

export type WaitlistInfo = {
  tierId: string | null;
  position: number;
  status: "WAITING" | "OFFERED" | "ACCEPTED" | "EXPIRED";
};

export function SeatMap({
  eventId,
  tiers,
  signedIn,
  waitlist = [],
}: {
  eventId: string;
  tiers: Tier[];
  signedIn: boolean;
  waitlist?: WaitlistInfo[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const seatById = useMemo(() => {
    const m = new Map<string, { seat: Seat; tier: Tier }>();
    for (const t of tiers) for (const s of t.seats) m.set(s.id, { seat: s, tier: t });
    return m;
  }, [tiers]);

  const rowsByTier = useMemo(
    () =>
      tiers.map((t) => {
        const rows = new Map<string, Seat[]>();
        for (const s of t.seats) {
          const list = rows.get(s.row) ?? [];
          list.push(s);
          rows.set(s.row, list);
        }
        return { tier: t, rows: [...rows.entries()] };
      }),
    [tiers]
  );

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id].slice(0, MAX_SEATS_PER_BOOKING)
    );

  const total = selected.reduce(
    (sum, id) => sum + (seatById.get(id)?.tier.price ?? 0),
    0
  );

  async function hold() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/holds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, seatIds: selected }),
      });
      if (res.status === 401) {
        router.push(
          `/api/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`
        );
        return;
      }
      if (res.status === 409) {
        setError("Some of those seats were just taken. The map has been refreshed — pick again.");
        setSelected([]);
        router.refresh();
        return;
      }
      if (!res.ok) throw new Error("Hold failed");
      const data = await res.json();
      router.push(`/checkout/${data.bookingId}`);
    } catch {
      setError("Something went wrong creating your hold. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-black/20 dark:border-white/20" /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-zinc-950 dark:bg-zinc-50" /> Selected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-zinc-300 dark:bg-zinc-700" /> Taken
        </span>
      </div>

      {rowsByTier.map(({ tier, rows }) => {
        const available = tier.seats.filter((s) => s.status === "AVAILABLE").length;
        const entry = waitlist.find((w) => w.tierId === tier.id);
        return (
        <div key={tier.id} className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">
              {tier.name} <span className="font-normal text-zinc-500">· {inr(tier.price)}</span>
            </h3>
            <span className="flex items-center gap-2 text-xs text-zinc-500">
              {entry && entry.status === "OFFERED" ? (
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  Seats are being held for you — pick them above
                </span>
              ) : available === 0 ? (
                entry ? (
                  <span>You're #{entry.position} on the waitlist</span>
                ) : (
                  <JoinWaitlistButton eventId={eventId} tierId={tier.id} signedIn={signedIn} />
                )
              ) : (
                <>{available} of {tier.seats.length} available</>
              )}
            </span>
          </div>
          <div className="mt-2 overflow-x-auto rounded-xl border border-black/10 p-4 dark:border-white/10">
            <div className="mx-auto mb-4 w-2/3 rounded bg-zinc-200 py-1 text-center text-[10px] uppercase tracking-widest text-zinc-500 dark:bg-zinc-800">
              Stage
            </div>
            <div className="flex min-w-max flex-col items-center gap-1.5">
              {rows.map(([row, seats]) => (
                <div key={row} className="flex items-center gap-1.5">
                  <span className="w-6 text-right font-mono text-[10px] text-zinc-500">{row}</span>
                  {seats.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      title={s.label}
                      disabled={s.status !== "AVAILABLE"}
                      onClick={() => toggle(s.id)}
                      className={`h-8 w-8 rounded-md border text-[10px] font-mono transition ${seatClass(s.status, selected.includes(s.id))}`}
                    >
                      {s.number}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        );
      })}

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Summary / CTA */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-black/10 p-4 dark:border-white/10">
        <div className="text-sm">
          {selected.length === 0 ? (
            <span className="text-zinc-500">Select up to {MAX_SEATS_PER_BOOKING} seats</span>
          ) : (
            <>
              <span className="font-medium">
                {selected.map((id) => seatById.get(id)?.seat.label).join(", ")}
              </span>
              <span className="ml-3 font-semibold">{inr(total)}</span>
            </>
          )}
        </div>
        {signedIn ? (
          <button
            type="button"
            disabled={selected.length === 0 || busy}
            onClick={hold}
            className="rounded-full bg-zinc-950 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {busy ? "Holding…" : `Hold ${selected.length > 0 ? `${selected.length} seat${selected.length > 1 ? "s" : ""}` : "seats"}`}
          </button>
        ) : (
          <Link
            href={`/api/auth/signin?callbackUrl=${encodeURIComponent(`/events/${eventId}`)}`}
            className="rounded-full bg-zinc-950 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Sign in to book
          </Link>
        )}
      </div>
    </div>
  );
}
