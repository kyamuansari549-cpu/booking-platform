"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CancelBookingButton({
  bookingId,
  status,
}: {
  bookingId: string;
  status: "PENDING" | "CONFIRMED";
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function cancel() {
    const verb = status === "CONFIRMED" ? "cancel this booking and issue a refund" : "release this hold";
    if (!window.confirm(`Are you sure you want to ${verb}?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Cancellation failed");
      setMessage(
        data.action === "refunded"
          ? "Booking cancelled — refund initiated."
          : "Hold released."
      );
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        disabled={busy}
        onClick={cancel}
        className="text-xs text-red-600 underline hover:text-red-800 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
      >
        {busy ? "Working…" : status === "CONFIRMED" ? "Cancel & refund" : "Release hold"}
      </button>
      {message && <span className="ml-2 text-xs text-zinc-500">{message}</span>}
    </span>
  );
}
