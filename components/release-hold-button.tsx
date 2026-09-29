"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReleaseHoldButton({ bookingId }: { bookingId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function release() {
    setBusy(true);
    await fetch("/api/holds", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookingId }),
    });
    router.push("/events");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={release}
      disabled={busy}
      className="text-sm text-zinc-500 underline hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-300"
    >
      {busy ? "Releasing…" : "Release seats"}
    </button>
  );
}
