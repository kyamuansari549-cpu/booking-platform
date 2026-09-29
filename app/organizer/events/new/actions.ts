"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { events, seats, ticketTiers } from "@/db/schema";

const tierSchema = z.object({
  name: z.string().trim().min(1).max(64),
  priceInr: z.number().positive().max(10_00_000),
  rows: z.string().trim().min(1).max(60), // e.g. "A,B,C"
  perRow: z.number().int().min(1).max(60),
});

const eventSchema = z.object({
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().min(10).max(5000),
  venue: z.string().trim().min(2).max(255),
  city: z.string().trim().min(2).max(128),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  tiers: z.array(tierSchema).min(1).max(6),
});

export type CreateEventState = { error: string } | null;

function parseRows(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((r) => r.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];
}

export async function createEvent(
  _prev: CreateEventState,
  input: unknown
): Promise<CreateEventState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Sign in required" };
  if (session.user.role === "USER") return { error: "Organizer access required" };

  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return { error: "Invalid date/time" };
  }
  if (endsAt <= startsAt) return { error: "End must be after start" };
  if (startsAt < new Date()) return { error: "Start must be in the future" };

  const tierRows = data.tiers.map((t) => ({ ...t, rowList: parseRows(t.rows) }));
  for (const t of tierRows) {
    if (t.rowList.length === 0) return { error: `Tier "${t.name}": no valid rows` };
    if (!/^[A-Z0-9]+$/.test(t.rowList.join(""))) {
      // rows are single alnum labels like A, B, C1
      return { error: `Tier "${t.name}": rows must be letters/numbers, comma-separated` };
    }
    const total = t.rowList.length * t.perRow;
    if (total > 2000) return { error: `Tier "${t.name}": max 2000 seats` };
  }

  await db.transaction(async (tx) => {
    const t = tx as unknown as typeof db;
    const [event] = await t
      .insert(events)
      .values({
        title: data.title,
        description: data.description,
        venue: data.venue,
        city: data.city,
        startsAt,
        endsAt,
        status: "DRAFT",
        organizerId: session.user.id,
      })
      .returning({ id: events.id });

    for (const tier of tierRows) {
      const [row] = await t
        .insert(ticketTiers)
        .values({
          eventId: event.id,
          name: tier.name,
          price: Math.round(tier.priceInr * 100), // INR → paise
          capacity: tier.rowList.length * tier.perRow,
        })
        .returning({ id: ticketTiers.id });

      const seatValues = tier.rowList.flatMap((r) =>
        Array.from({ length: tier.perRow }, (_, i) => ({
          tierId: row.id,
          label: `${r}-${i + 1}`,
          row: r,
          number: i + 1,
        }))
      );
      await t.insert(seats).values(seatValues);
    }
  });

  revalidatePath("/organizer");
  redirect("/organizer");
}
