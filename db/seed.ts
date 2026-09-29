/**
 * Seed demo data: one organizer, two published events with seat maps.
 *
 * Run:  npm run db:seed   (requires DATABASE_URL)
 */
import { db } from "./index";
import { users, events, ticketTiers, seats } from "./schema";

function seatLabels(rows: string[], perRow: number) {
  const out: { row: string; number: number; label: string }[] = [];
  for (const row of rows) {
    for (let n = 1; n <= perRow; n++) {
      out.push({ row, number: n, label: `${row}-${n}` });
    }
  }
  return out;
}

async function main() {
  console.log("Seeding…");

  const [organizer] = await db
    .insert(users)
    .values({
      name: "Demo Organizer",
      email: "organizer@seatbook.demo",
      role: "ORGANIZER",
    })
    .onConflictDoNothing({ target: users.email })
    .returning();
  const organizerId =
    organizer?.id ??
    (await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.email, "organizer@seatbook.demo"),
    }))!.id;

  // Clean slate for demo events
  await db.delete(events);

  const [concert] = await db
    .insert(events)
    .values({
      title: "Neon Nights — Live in Concert",
      description:
        "A three-hour synthwave spectacular with a full light show. Gates open at 6 PM.",
      venue: "Phoenix Arena",
      city: "Bengaluru",
      startsAt: new Date(Date.now() + 21 * 24 * 3600 * 1000),
      endsAt: new Date(Date.now() + 21 * 24 * 3600 * 1000 + 3 * 3600 * 1000),
      status: "PUBLISHED",
      organizerId,
    })
    .returning();

  const [conf] = await db
    .insert(events)
    .values({
      title: "ShipIt DevConf 2026",
      description:
        "Two days of talks and workshops on full-stack engineering, AI agents, and shipping.",
      venue: "Convention Centre, Hall B",
      city: "Hyderabad",
      startsAt: new Date(Date.now() + 45 * 24 * 3600 * 1000),
      endsAt: new Date(Date.now() + 46 * 24 * 3600 * 1000),
      status: "PUBLISHED",
      organizerId,
    })
    .returning();

  const tierSpecs = [
    // event, tier name, price (paise), rows, seats per row
    { event: concert, name: "VIP", price: 499900, rows: ["A", "B"], perRow: 10 },
    {
      event: concert,
      name: "General",
      price: 149900,
      rows: ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
      perRow: 10,
    },
    { event: conf, name: "Pro", price: 999900, rows: ["A", "B", "C"], perRow: 12 },
    {
      event: conf,
      name: "Standard",
      price: 499900,
      rows: ["D", "E", "F", "G", "H"],
      perRow: 12,
    },
  ];

  for (const spec of tierSpecs) {
    const [tier] = await db
      .insert(ticketTiers)
      .values({
        eventId: spec.event.id,
        name: spec.name,
        price: spec.price,
        capacity: spec.rows.length * spec.perRow,
      })
      .returning();

    await db.insert(seats).values(
      seatLabels(spec.rows, spec.perRow).map((s) => ({
        tierId: tier.id,
        label: s.label,
        row: s.row,
        number: s.number,
      }))
    );
    console.log(
      `  ${spec.event.title} / ${spec.name}: ${spec.rows.length * spec.perRow} seats`
    );
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
