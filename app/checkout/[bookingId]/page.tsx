import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { getBookingForUser } from "@/lib/holds";
import { inr } from "@/lib/format";
import { HoldCountdown } from "@/components/hold-countdown";
import { ReleaseHoldButton } from "@/components/release-hold-button";
import { RazorpayPayButton } from "@/components/razorpay-pay-button";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/checkout/${bookingId}`)}`);
  }

  const booking = await getBookingForUser(db, session.user.id, bookingId);
  if (!booking) notFound();

  if (booking.status === "EXPIRED") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">This hold expired</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Your 10-minute hold lapsed and the seats were released.
        </p>
        <Link
          href={`/events/${booking.eventId}`}
          className="mt-6 inline-block rounded-full bg-zinc-950 px-6 py-2.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
        >
          Pick seats again
        </Link>
      </div>
    );
  }

  if (booking.status === "CONFIRMED") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">You&apos;re booked!</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {booking.eventTitle} ·{" "}
          {booking.seats.map((s) => s.label).join(", ")}
        </p>
        <Link href="/bookings" className="mt-6 inline-block text-sm underline">
          View my bookings
        </Link>
      </div>
    );
  }

  if (booking.status !== "PENDING") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">Booking {booking.status.toLowerCase()}</h1>
        <Link href="/bookings" className="mt-6 inline-block text-sm underline">
          Back to my bookings
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Checkout</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Seats held for <HoldCountdown expiresAt={booking.holdExpiresAt!.toISOString()} />
      </p>

      <div className="mt-8 rounded-2xl border border-black/10 p-6 dark:border-white/10">
        <h2 className="font-semibold">{booking.eventTitle}</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {booking.seats.map((s) => (
            <li key={s.id} className="flex justify-between">
              <span>
                Seat {s.label} <span className="text-zinc-500">· {s.tierName}</span>
              </span>
              <span>{inr(s.price)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between border-t border-black/10 pt-4 font-semibold dark:border-white/10">
          <span>Total</span>
          <span>{inr(booking.totalAmount)}</span>
        </div>
      </div>

      <div className="mt-6">
        <RazorpayPayButton bookingId={booking.id} label={inr(booking.totalAmount)} />
        <div className="mt-3 text-center">
          <ReleaseHoldButton bookingId={booking.id} />
        </div>
      </div>
    </div>
  );
}
