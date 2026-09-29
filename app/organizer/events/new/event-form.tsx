"use client";

import { useActionState, useState } from "react";
import { createEvent, type CreateEventState } from "./actions";

type TierRow = { name: string; priceInr: string; rows: string; perRow: string };

const emptyTier = (): TierRow => ({ name: "", priceInr: "", rows: "", perRow: "" });

const inputCls =
  "w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/15";

export function EventForm() {
  const [tiers, setTiers] = useState<TierRow[]>([
    { name: "VIP", priceInr: "4999", rows: "A,B", perRow: "10" },
    { name: "General", priceInr: "1499", rows: "C,D,E,F", perRow: "10" },
  ]);
  const [state, formAction, pending] = useActionState<CreateEventState, FormData>(
    async (_prev, formData) => {
      const payload = {
        title: formData.get("title"),
        description: formData.get("description"),
        venue: formData.get("venue"),
        city: formData.get("city"),
        startsAt: formData.get("startsAt"),
        endsAt: formData.get("endsAt"),
        tiers: tiers.map((t) => ({
          name: t.name,
          priceInr: Number(t.priceInr),
          rows: t.rows,
          perRow: Number(t.perRow),
        })),
      };
      return createEvent(null, payload);
    },
    null
  );

  const setTier = (i: number, patch: Partial<TierRow>) =>
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  return (
    <form action={formAction} className="mt-8 max-w-2xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium">Event title</span>
          <input name="title" required minLength={3} className={inputCls} placeholder="Neon Nights — Live in Concert" />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium">Description</span>
          <textarea name="description" required minLength={10} rows={3} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Venue</span>
          <input name="venue" required className={inputCls} placeholder="Phoenix Arena" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">City</span>
          <input name="city" required className={inputCls} placeholder="Bengaluru" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Starts at</span>
          <input name="startsAt" type="datetime-local" required className={inputCls} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Ends at</span>
          <input name="endsAt" type="datetime-local" required className={inputCls} />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Ticket tiers & seat map</h2>
          <button
            type="button"
            onClick={() => setTiers((p) => [...p, emptyTier()])}
            className="text-sm underline"
          >
            Add tier
          </button>
        </div>
        <div className="mt-3 space-y-4">
          {tiers.map((t, i) => (
            <div key={i} className="rounded-xl border border-black/10 p-4 dark:border-white/10">
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="block">
                  <span className="text-xs text-zinc-500">Tier name</span>
                  <input value={t.name} onChange={(e) => setTier(i, { name: e.target.value })} className={inputCls} placeholder="VIP" />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">Price (₹)</span>
                  <input value={t.priceInr} onChange={(e) => setTier(i, { priceInr: e.target.value })} inputMode="decimal" className={inputCls} placeholder="1499" />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">Rows (comma-separated)</span>
                  <input value={t.rows} onChange={(e) => setTier(i, { rows: e.target.value })} className={inputCls} placeholder="A,B,C" />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">Seats per row</span>
                  <input value={t.perRow} onChange={(e) => setTier(i, { perRow: e.target.value })} inputMode="numeric" className={inputCls} placeholder="10" />
                </label>
              </div>
              {tiers.length > 1 && (
                <button type="button" onClick={() => setTiers((p) => p.filter((_, idx) => idx !== i))} className="mt-2 text-xs text-red-600 underline dark:text-red-400">
                  Remove tier
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Seats are auto-generated as labels like A-1, A-2… The event is created as a draft; publish it from the organizer dashboard.
        </p>
      </div>

      {state?.error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-zinc-950 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {pending ? "Creating…" : "Create event"}
      </button>
    </form>
  );
}
