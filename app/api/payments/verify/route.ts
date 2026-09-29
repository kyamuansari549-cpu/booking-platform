import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { getBookingForUser } from "@/lib/holds";
import {
  confirmBookingPayment,
  recordCapturedPayment,
} from "@/lib/payments";
import {
  createRazorpayRefund,
  PaymentsNotConfiguredError,
  verifyPaymentSignature,
} from "@/lib/razorpay";

const schema = z.object({
  bookingId: z.string().uuid(),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

/**
 * Called by checkout.js's handler after a successful payment.
 * Verifies the HMAC signature, then confirms the booking idempotently.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    parsed.data;

  if (
    !verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.providerOrderId, razorpay_order_id))
    .limit(1);
  if (!payment || payment.bookingId !== bookingId) {
    return NextResponse.json({ error: "Order not recognized" }, { status: 404 });
  }

  // If the hold lapsed while the user was paying, the money may still have
  // been captured — record it and refund automatically instead of losing it.
  const booking = await getBookingForUser(db, session.user.id, bookingId);
  if (!booking || booking.status !== "PENDING") {
    await recordCapturedPayment(db, bookingId, razorpay_payment_id);
    try {
      await createRazorpayRefund(razorpay_payment_id, payment.amount);
      await db
        .update(payments)
        .set({ status: "REFUNDED", updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      return NextResponse.json(
        { error: "Hold expired before payment completed — amount refunded automatically", refunded: true },
        { status: 410 }
      );
    } catch (e) {
      if (!(e instanceof PaymentsNotConfiguredError)) {
        console.error("auto-refund failed:", e);
      }
      return NextResponse.json(
        { error: "Hold expired after payment was captured — contact support for a refund" },
        { status: 410 }
      );
    }
  }

  try {
    await confirmBookingPayment(db, bookingId, razorpay_payment_id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Confirmation failed" },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
