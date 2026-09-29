import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { setCheckedIn } from "@/lib/organizer";

const schema = z.object({ checkedIn: z.boolean() });

/** Toggle check-in for a booking on the organizer's event. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const ok = await setCheckedIn(db, session.user.id, id, parsed.data.checkedIn);
  if (!ok) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  return NextResponse.json({ ok: true, checkedIn: parsed.data.checkedIn });
}
