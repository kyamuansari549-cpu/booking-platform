import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

// Money is stored in paise (INR minor units).
// Seat holds use Redis TTL; the DB is the source of truth.

export const roleEnum = pgEnum("role", ["USER", "ORGANIZER", "ADMIN"]);
export const eventStatusEnum = pgEnum("event_status", [
  "DRAFT",
  "PUBLISHED",
  "CANCELLED",
]);
export const seatStatusEnum = pgEnum("seat_status", [
  "AVAILABLE",
  "HELD",
  "SOLD",
]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "PENDING", // seats held, payment not complete
  "CONFIRMED", // payment captured
  "CANCELLED", // cancelled before payment
  "REFUNDED", // payment refunded
  "EXPIRED", // hold TTL lapsed
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
]);
export const waitlistStatusEnum = pgEnum("waitlist_status", [
  "WAITING",
  "OFFERED",
  "ACCEPTED",
  "EXPIRED",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    email: varchar("email", { length: 255 }).notNull().unique(),
    image: text("image"),
    role: roleEnum("role").notNull().default("USER"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("users_email_idx").on(t.email)]
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    venue: varchar("venue", { length: 255 }).notNull(),
    city: varchar("city", { length: 128 }).notNull().default(""),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    status: eventStatusEnum("status").notNull().default("DRAFT"),
    coverImage: text("cover_image"),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("events_status_starts_idx").on(t.status, t.startsAt),
    index("events_organizer_idx").on(t.organizerId),
  ]
);

export const ticketTiers = pgTable(
  "ticket_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(), // "VIP", "General"
    price: integer("price").notNull(), // paise
    capacity: integer("capacity").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("tiers_event_idx").on(t.eventId)]
);

export const seats = pgTable(
  "seats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => ticketTiers.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 16 }).notNull(), // "A-12"
    row: varchar("row", { length: 8 }).notNull(),
    number: integer("number").notNull(),
    status: seatStatusEnum("status").notNull().default("AVAILABLE"),
  },
  (t) => [
    uniqueIndex("seats_tier_label_uidx").on(t.tierId, t.label),
    index("seats_tier_status_idx").on(t.tierId, t.status),
  ]
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    status: bookingStatusEnum("status").notNull().default("PENDING"),
    totalAmount: integer("total_amount").notNull(), // paise
    holdExpiresAt: timestamp("hold_expires_at"),
    checkedInAt: timestamp("checked_in_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("bookings_user_status_idx").on(t.userId, t.status),
    index("bookings_event_status_idx").on(t.eventId, t.status),
  ]
);

export const bookingSeats = pgTable(
  "booking_seats",
  {
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id),
  },
  (t) => [
    primaryKey({ columns: [t.bookingId, t.seatId] }),
    index("booking_seats_seat_idx").on(t.seatId),
  ]
);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .unique()
    .references(() => bookings.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull().default("razorpay"),
  providerOrderId: varchar("provider_order_id", { length: 128 }).unique(),
  providerPaymentId: varchar("provider_payment_id", { length: 128 }).unique(),
  amount: integer("amount").notNull(), // paise
  currency: varchar("currency", { length: 8 }).notNull().default("INR"),
  status: paymentStatusEnum("status").notNull().default("CREATED"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id"),
    seatsWanted: integer("seats_wanted").notNull().default(1),
    position: integer("position").notNull(),
    status: waitlistStatusEnum("status").notNull().default("WAITING"),
    offeredAt: timestamp("offered_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("waitlist_user_event_tier_uidx").on(
      t.userId,
      t.eventId,
      t.tierId
    ),
    index("waitlist_event_status_pos_idx").on(t.eventId, t.status, t.position),
  ]
);
