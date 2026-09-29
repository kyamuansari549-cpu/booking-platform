"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function JoinWaitlistButton({
  eventId,
  tierId,
  signedIn,
}: {
  eventId: string;
  tierId: string;
  signedIn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function join() {
    if (!signedIn) {
      router.push(
        `/api/auth/signin?callbackUrl=${encodeURIComponent(`/events/${eventId}`)}`
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, tierId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not join waitlist");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        disabled={busy}
        onClick={join}
        className="rounded-full border border-zinc-950 px-4 py-1.5 text-xs font-medium hover:bg-zinc-950 hover:text-white disabled:opacity-40 dark:border-zinc-50 dark:hover:bg-zinc-50 dark:hover:text-zinc-950"
      >
        {busy ? "Joining…" : "Join waitlist"}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function LeaveWaitlistButton({ entryId }: { entryId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function leave() {
    setBusy(true);
    await fetch("/api/waitlist", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId }),
    });
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={leave}
      className="text-xs text-zinc-500 underline hover:text-zinc-800 disabled:opacity-40 dark:hover:text-zinc-200"
    >
      {busy ? "Leaving…" : "Leave waitlist"}
    </button>
  );
}
