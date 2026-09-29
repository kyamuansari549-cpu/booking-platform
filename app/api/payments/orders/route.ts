import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { getBookingForUser } from "@/lib/holds";
import { ensurePaymentForBooking } from "@/lib/payments";
import {
  createRazorpayOrder,
  getRazorpayKeyId,
  PaymentsNotConfiguredError,
} from "@/lib/razorpay";

const schema = z.object({ bookingId: z.string().uuid() });

/**
 * Create a Razorpay order for a PENDING booking. Called by the checkout
 * page right before opening the Razorpay modal.
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

  const booking = await getBookingForUser(
    db,
    session.user.id,
    parsed.data.bookingId
  );
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (booking.status !== "PENDING") {
    return NextResponse.json(
      { error: `Booking is ${booking.status.toLowerCase()}` },
      { status: 409 }
    );
  }

  try {
    const payment = await ensurePaymentForBooking(
      db,
      booking.id,
      booking.totalAmount
    );

    let orderId = payment.providerOrderId;
    if (!orderId) {
      const order = await createRazorpayOrder(booking.id, booking.totalAmount);
      orderId = order.id as string;
      await db
        .update(payments)
        .set({ providerOrderId: orderId, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
    }

    return NextResponse.json({
      keyId: getRazorpayKeyId(),
      orderId,
      amount: booking.totalAmount,
      currency: "INR",
      name: session.user.name ?? undefined,
      email: session.user.email ?? undefined,
    });
  } catch (e) {
    if (e instanceof PaymentsNotConfiguredError) {
      return NextResponse.json(
        { error: "Payments are not configured yet" },
        { status: 503 }
      );
    }
    throw e;
  }
}
