"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CheckinButton({
  bookingId,
  checkedIn,
}: {
  bookingId: string;
  checkedIn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    setBusy(true);
    await fetch(`/api/organizer/bookings/${bookingId}/checkin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkedIn: !checkedIn }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={toggle}
      className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-40 ${
        checkedIn
          ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
          : "border border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
      }`}
    >
      {busy ? "…" : checkedIn ? "Checked in" : "Check in"}
    </button>
  );
}

export function OrganizerRefundButton({ bookingId }: { bookingId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function refund() {
    if (
      !window.confirm(
        "Refund this booking? The seats will be released and offered to the waitlist."
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizer/bookings/${bookingId}/refund`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Refund failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refund failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        disabled={busy}
        onClick={refund}
        className="text-xs text-red-600 underline hover:text-red-800 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
      >
        {busy ? "Refunding…" : "Refund"}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}
