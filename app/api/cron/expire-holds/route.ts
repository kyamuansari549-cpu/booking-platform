import { NextResponse } from "next/server";
import { db } from "@/db";
import { expireStaleHolds } from "@/lib/holds";
import { expireStaleOffers } from "@/lib/waitlist";

/**
 * Sweeper for lapsed seat holds and stale waitlist offers.
 * Meant for Vercel Cron (daily on Hobby; every few minutes on Pro), but the
 * app also expires lazily on read so this is belt-and-suspenders.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const expired = await expireStaleHolds(db);
  const offersExpired = await expireStaleOffers(db);
  return NextResponse.json({ expired, offersExpired });
}
