"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(() =>
    Math.max(0, new Date(expiresAt).getTime() - Date.now())
  );

  useEffect(() => {
    const t = setInterval(() => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= 0) {
        clearInterval(t);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, router]);

  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const urgent = left < 120000;

  return (
    <span
      className={`font-mono font-semibold ${urgent ? "text-red-600 dark:text-red-400" : ""}`}
    >
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}
