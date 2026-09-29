import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { joinWaitlist, leaveWaitlist } from "@/lib/waitlist";

const joinSchema = z.object({
  eventId: z.string().uuid(),
  tierId: z.string().uuid().nullable().optional(),
  seatsWanted: z.number().int().min(1).max(10).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const parsed = joinSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const entry = await joinWaitlist(
      db,
      session.user.id,
      parsed.data.eventId,
      parsed.data.tierId ?? null,
      parsed.data.seatsWanted ?? 1
    );
    return NextResponse.json({ ok: true, entry });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not join waitlist" },
      { status: 409 }
    );
  }
}

const leaveSchema = z.object({ entryId: z.string().uuid() });

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const parsed = leaveSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const removed = await leaveWaitlist(db, session.user.id, parsed.data.entryId);
  if (!removed) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
