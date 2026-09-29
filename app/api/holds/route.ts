import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { createHold, releaseHold, SeatUnavailableError } from "@/lib/holds";

const holdSchema = z.object({
  eventId: z.string().uuid(),
  seatIds: z.array(z.string().uuid()).min(1).max(10),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const parsed = holdSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const hold = await createHold(
      db,
      session.user.id,
      parsed.data.eventId,
      parsed.data.seatIds
    );
    return NextResponse.json(hold, { status: 201 });
  } catch (e) {
    if (e instanceof SeatUnavailableError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}

const releaseSchema = z.object({ bookingId: z.string().uuid() });

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const parsed = releaseSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const released = await releaseHold(db, session.user.id, parsed.data.bookingId);
  if (!released) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
