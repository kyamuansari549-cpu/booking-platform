import { NextResponse } from "next/server";
import { db } from "@/db";
import { expireStaleHolds } from "@/lib/holds";

/**
 * Sweeper for lapsed seat holds. Meant for Vercel Cron (every minute),
 * but the app also expires lazily on read so this is belt-and-suspenders.
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
  return NextResponse.json({ expired });
}
