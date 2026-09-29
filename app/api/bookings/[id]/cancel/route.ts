import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { getBookingForUser, releaseHold } from "@/lib/holds";
import { refundBooking } from "@/lib/payments";
import { PaymentsNotConfiguredError } from "@/lib/razorpay";

/**
 * POST /api/bookings/[id]/cancel
 * - PENDING  → release the hold (booking → CANCELLED)
 * - CONFIRMED → refund via Razorpay, release seats, offer to waitlist
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const { id } = await params;

  const booking = await getBookingForUser(db, session.user.id, id);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  if (booking.status === "PENDING") {
    await releaseHold(db, session.user.id, id);
    return NextResponse.json({ ok: true, action: "hold_released" });
  }

  if (booking.status === "CONFIRMED") {
    try {
      const { refundId } = await refundBooking(db, id, session.user.id);
      return NextResponse.json({ ok: true, action: "refunded", refundId });
    } catch (e) {
      if (e instanceof PaymentsNotConfiguredError) {
        return NextResponse.json(
          { error: "Refunds are not configured yet" },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Refund failed" },
        { status: 502 }
      );
    }
  }

  return NextResponse.json(
    { error: `Booking is ${booking.status.toLowerCase()}, nothing to cancel` },
    { status: 409 }
  );
}
