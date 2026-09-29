import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { refundBookingAsOrganizer } from "@/lib/payments";
import { PaymentsNotConfiguredError } from "@/lib/razorpay";

/** Organizer-initiated refund of a CONFIRMED booking on their event. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const { refundId } = await refundBookingAsOrganizer(db, session.user.id, id);
    return NextResponse.json({ ok: true, refundId });
  } catch (e) {
    if (e instanceof PaymentsNotConfiguredError) {
      return NextResponse.json(
        { error: "Refunds are not configured yet" },
        { status: 503 }
      );
    }
    const msg = e instanceof Error ? e.message : "Refund failed";
    const status = msg.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
