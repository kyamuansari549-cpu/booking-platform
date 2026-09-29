import { and, eq, inArray } from "drizzle-orm";
import {
  bookings,
  bookingSeats,
  payments,
  seats,
} from "@/db/schema";
import type { Db } from "./holds";
import { redis } from "./redis";
import { createRazorpayRefund, PaymentsNotConfiguredError } from "./razorpay";
import { fulfillWaitlist } from "./waitlist";

/**
 * Get the payment row for a booking, creating it in CREATED state if needed.
 */
export async function ensurePaymentForBooking(
  db: Db,
  bookingId: string,
  amountPaise: number
) {
  const [existing] = await db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, bookingId))
    .limit(1);
  if (existing) return existing;

  const [row] = await db
    .insert(payments)
    .values({ bookingId, amount: amountPaise })
    .returning();
  return row;
}

/**
 * Confirm a booking after payment capture. Idempotent: if the payment is
 * already CAPTURED this is a no-op returning "already".
 *
 * Must only be called after verifying the Razorpay signature.
 */
export async function confirmBookingPayment(
  db: Db,
  bookingId: string,
  providerPaymentId: string
): Promise<"confirmed" | "already"> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;

    const [payment] = await t
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .limit(1);
    if (!payment) throw new Error("Payment row not found");
    if (payment.status === "CAPTURED") return "already";
    if (payment.status !== "CREATED" && payment.status !== "AUTHORIZED") {
      throw new Error(`Cannot confirm payment in status ${payment.status}`);
    }

    const [booking] = await t
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update")
      .limit(1);
    if (!booking) throw new Error("Booking not found");
    if (booking.status !== "PENDING") {
      throw new Error(`Cannot confirm booking in status ${booking.status}`);
    }

    const links = await t
      .select({ seatId: bookingSeats.seatId })
      .from(bookingSeats)
      .where(eq(bookingSeats.bookingId, bookingId));
    const seatIds = links.map((l) => l.seatId);

    await t
      .update(payments)
      .set({
        status: "CAPTURED",
        providerPaymentId,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    await t
      .update(bookings)
      .set({ status: "CONFIRMED", updatedAt: new Date() })
      .where(eq(bookings.id, bookingId));

    if (seatIds.length > 0) {
      await t
        .update(seats)
        .set({ status: "SOLD" })
        .where(and(inArray(seats.id, seatIds), eq(seats.status, "HELD")));
    }

    if (redis && seatIds.length > 0) {
      try {
        await redis.del(...seatIds.map((id) => `seatlock:${id}`));
      } catch {
        // best effort
      }
    }

    return "confirmed";
  });
}

/**
 * Record that money was captured for a booking whose hold already lapsed.
 * Only touches payments still in CREATED/AUTHORIZED — never overwrites a
 * REFUNDED or already-CAPTURED row (webhook replays are safe).
 * The seat stays released; the organizer refunds from the dashboard.
 */
export async function recordCapturedPayment(
  db: Db,
  bookingId: string,
  providerPaymentId: string
) {
  await db
    .update(payments)
    .set({
      status: "CAPTURED",
      providerPaymentId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(payments.bookingId, bookingId),
        inArray(payments.status, ["CREATED", "AUTHORIZED"])
      )
    );
}

/**
 * Mark a payment as failed and release the held seats (booking → CANCELLED).
 * Used by the payment.failed webhook. Never touches a payment that already
 * reached a terminal state (CAPTURED/REFUNDED).
 */
export async function failBookingPayment(db: Db, bookingId: string) {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [payment] = await t
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .limit(1);
    if (
      payment &&
      (payment.status === "CREATED" || payment.status === "AUTHORIZED")
    ) {
      await t
        .update(payments)
        .set({ status: "FAILED", updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
    }

    const links = await t
      .select({ seatId: bookingSeats.seatId })
      .from(bookingSeats)
      .where(eq(bookingSeats.bookingId, bookingId));
    const seatIds = links.map((l) => l.seatId);
    if (seatIds.length > 0) {
      await t
        .update(seats)
        .set({ status: "AVAILABLE" })
        .where(and(inArray(seats.id, seatIds), eq(seats.status, "HELD")));
    }
    await t
      .update(bookings)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "PENDING")));
  });
}

export type RefundFn = (
  providerPaymentId: string,
  amountPaise: number
) => Promise<string>;

/**
 * Refund a CONFIRMED booking: refund via provider, release seats, then
 * offer the freed seats to the waitlist. refundFn is injectable for tests.
 */
export async function refundBooking(
  db: Db,
  bookingId: string,
  userId: string,
  refundFn: RefundFn = createRazorpayRefund
): Promise<{ refundId: string }> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.userId, userId),
        eq(bookings.status, "CONFIRMED")
      )
    )
    .limit(1);
  if (!booking) throw new Error("Confirmed booking not found");

  const [payment] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.bookingId, bookingId),
        eq(payments.status, "CAPTURED")
      )
    )
    .limit(1);
  if (!payment?.providerPaymentId) throw new Error("Captured payment not found");

  let refundId: string;
  try {
    refundId = await refundFn(payment.providerPaymentId, payment.amount);
  } catch (e) {
    if (e instanceof PaymentsNotConfiguredError) throw e;
    throw new Error(
      `Refund failed at provider: ${e instanceof Error ? e.message : e}`
    );
  }

  // Collect freed tiers before releasing, for waitlist fulfillment.
  const seatTiers = await db
    .select({ tierId: seats.tierId })
    .from(bookingSeats)
    .innerJoin(seats, eq(seats.id, bookingSeats.seatId))
    .where(eq(bookingSeats.bookingId, bookingId));
  const tierIds = [...new Set(seatTiers.map((s) => s.tierId))];

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const links = await t
      .select({ seatId: bookingSeats.seatId })
      .from(bookingSeats)
      .where(eq(bookingSeats.bookingId, bookingId));
    const seatIds = links.map((l) => l.seatId);

    await t
      .update(payments)
      .set({ status: "REFUNDED", updatedAt: new Date() })
      .where(eq(payments.id, payment.id));
    await t
      .update(bookings)
      .set({ status: "REFUNDED", updatedAt: new Date() })
      .where(eq(bookings.id, bookingId));
    if (seatIds.length > 0) {
      await t
        .update(seats)
        .set({ status: "AVAILABLE" })
        .where(inArray(seats.id, seatIds));
    }
  });

  for (const tierId of tierIds) {
    await fulfillWaitlist(db, booking.eventId, tierId);
  }

  return { refundId };
}
