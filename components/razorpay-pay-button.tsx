"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, cb: (err: unknown) => void) => void;
    };
  }
}

function loadCheckoutJs(): Promise<boolean> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function RazorpayPayButton({
  bookingId,
  label,
}: {
  bookingId: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      if (!(await loadCheckoutJs())) throw new Error("Could not load Razorpay checkout");

      const orderRes = await fetch("/api/payments/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error ?? "Could not start payment");

      const rzp = new window.Razorpay!({
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "Booking Platform",
        description: "Seat booking",
        order_id: orderData.orderId,
        prefill: { name: orderData.name ?? "", email: orderData.email ?? "" },
        theme: { color: "#18181b" },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          const verifyRes = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ bookingId, ...resp }),
          });
          const verifyData = await verifyRes.json();
          if (!verifyRes.ok) {
            setError(verifyData.error ?? "Payment verification failed");
            setBusy(false);
            return;
          }
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed to start");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={pay}
        className="rounded-full bg-zinc-950 px-8 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {busy ? "Processing…" : `Pay ${label}`}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <p className="mt-2 text-xs text-zinc-500">Secured by Razorpay</p>
    </div>
  );
}
