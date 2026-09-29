import crypto from "node:crypto";
import Razorpay from "razorpay";

export class PaymentsNotConfiguredError extends Error {
  constructor() {
    super("Razorpay keys are not configured");
    this.name = "PaymentsNotConfiguredError";
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new PaymentsNotConfiguredError();
  return v;
}

/** Lazily constructed so importing this module never throws. */
export function getRazorpayClient() {
  return new Razorpay({
    key_id: required("RAZORPAY_KEY_ID"),
    key_secret: required("RAZORPAY_KEY_SECRET"),
  });
}

export function getRazorpayKeyId(): string {
  return required("RAZORPAY_KEY_ID");
}

/**
 * Verify the signature Razorpay checkout.js returns on successful payment.
 * signature = HMAC_SHA256(key_secret, order_id + "|" + payment_id)
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string = process.env.RAZORPAY_KEY_SECRET ?? ""
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

/**
 * Verify a webhook payload signature.
 * signature = HMAC_SHA256(webhook_secret, raw_request_body)
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string = process.env.RAZORPAY_WEBHOOK_SECRET ?? ""
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

export async function createRazorpayOrder(bookingId: string, amountPaise: number) {
  const client = getRazorpayClient();
  return client.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt: `booking_${bookingId}`,
    notes: { bookingId },
  });
}

export async function createRazorpayRefund(
  providerPaymentId: string,
  amountPaise: number
): Promise<string> {
  const client = getRazorpayClient();
  const refund = await client.payments.refund(providerPaymentId, {
    amount: amountPaise,
    notes: { reason: "booking_cancelled" },
  });
  return refund.id as string;
}
