import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings, payments } from "@/db/schema";
import {
  confirmBookingPayment,
  failBookingPayment,
  recordCapturedPayment,
} from "@/lib/payments";
import { verifyWebhookSignature } from "@/lib/razorpay";

type RazorpayWebhookEvent = {
  event: string;
  payload: {
    payment: {
      entity: {
        id: string;
        order_id: string;
        status: string;
      };
    };
  };
};

/**
 * Razorpay webhook. Must receive the RAW body for signature verification,
 * hence req.text() instead of req.json().
 *
 * Handles:
 *  - payment.captured → confirm booking (idempotent)
 *  - payment.failed   → release the held seats
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let evt: RazorpayWebhookEvent;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const entity = evt.payload?.payment?.entity;
  if (!entity?.order_id) return NextResponse.json({ ok: true });

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.providerOrderId, entity.order_id))
    .limit(1);
  if (!payment) return NextResponse.json({ ok: true });

  try {
    if (evt.event === "payment.captured") {
      const [b] = await db
        .select({ status: bookings.status })
        .from(bookings)
        .where(eq(bookings.id, payment.bookingId))
        .limit(1);
      if (b?.status === "PENDING") {
        await confirmBookingPayment(db, payment.bookingId, entity.id);
      } else {
        // Late capture after the hold lapsed: record the money so the
        // organizer can refund it. Seats stay released. recordCapturedPayment
        // never overwrites a REFUNDED row, so replays are safe.
        await recordCapturedPayment(db, payment.bookingId, entity.id);
      }
    } else if (evt.event === "payment.failed") {
      await failBookingPayment(db, payment.bookingId);
    }
  } catch (e) {
    // Log-and-ack: Razorpay retries webhooks, and our confirm path is
    // idempotent, so a retry is safe. Never 500 on a signature-valid event.
    console.error("webhook handling failed:", e);
  }

  return NextResponse.json({ ok: true });
}
