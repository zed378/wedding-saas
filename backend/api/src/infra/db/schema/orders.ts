import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  integer,
  bigint,
  jsonb,
  text,
  inet,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";

import { users } from "./users.ts";
import { invitations } from "./invitations.ts";

/**
 * The commercial tables. `docs/DATABASE/07`, `08` and `10`.
 *
 * Money is BIGINT rupiah throughout -- never a float, never a decimal string. And the
 * master price tables here are the ONLY source of an order's amount: `docs/SECURITY/07`
 * § Pricing forbids taking a price from the client, so a client-supplied amount has
 * nowhere in this schema to land.
 */

/**
 * Master package prices. The primary key is a VARCHAR because the id IS the business
 * identifier -- 'standard' -- not an opaque surrogate. Seeded, not migrated: prices
 * change without a schema change.
 */
export const packages = pgTable("packages", {
  id: varchar("id", { length: 30 }).primaryKey(),
  name: varchar("name", { length: 60 }).notNull(),
  /** Rupiah, as an integer. The source of truth for pricing (`docs/SECURITY/07`). */
  price: bigint("price", { mode: "bigint" }).notNull(),
  durationMonths: integer("duration_months").notNull(),
  maxPhotos: integer("max_photos").notNull(),
  hasWatermark: boolean("has_watermark").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
});

/**
 * Master addon prices. At MVP no addon is active: `custom_domain` waits for the
 * Phase 7 feature (ADR-022) and `extended_validity` is redundant beside a 12-month
 * package. `is_active` is the gate, and the order service refuses an inactive addon.
 */
export const addons = pgTable("addons", {
  id: varchar("id", { length: 30 }).primaryKey(),
  name: varchar("name", { length: 60 }).notNull(),
  price: bigint("price", { mode: "bigint" }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

/**
 * An order. RESTRICT in both directions to `invitations` and `users`: payment history
 * must never be lost because a row it points at was deleted (`docs/DATABASE/01`).
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    packageId: varchar("package_id", { length: 30 })
      .notNull()
      .references(() => packages.id),
    /**
     * An array of addon ids, so there is NO referential integrity here -- an order can
     * name an addon that does not exist. That follows `docs/DATABASE/07`; the service
     * validates against `addons` before insert.
     */
    addonIds: varchar("addon_ids", { length: 30 })
      .array()
      .notNull()
      .default(sql`'{}'`),
    /**
     * A SNAPSHOT taken when the order was created, never recalculated on read.
     * A later price change must not rewrite what a customer already agreed to pay,
     * and an order history that moves with the price list is not a history.
     */
    amountTotal: bigint("amount_total", { mode: "bigint" }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    orderType: varchar("order_type", { length: 20 })
      .notNull()
      .default("new_publish"),
    expiredAt: timestamp("expired_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_orders_invitation").on(t.invitationId),
    index("idx_orders_user").on(t.userId),
    index("idx_orders_status").on(t.status),
    check(
      "orders_status_check",
      sql`status IN ('pending', 'paid', 'failed', 'expired', 'refunded')`,
    ),
    check(
      "orders_order_type_check",
      sql`order_type IN ('new_publish', 'renewal')`,
    ),
  ],
);

/**
 * A payment attempt.
 *
 * The unique index below is the entire idempotency story for webhooks, and it lives
 * here rather than in application code for one reason: a provider retry is normal
 * traffic, not an error, and a guarantee that depends on every future handler
 * remembering to check first is not a guarantee.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: varchar("provider", { length: 30 }).notNull(),
    providerReferenceId: varchar("provider_reference_id", {
      length: 150,
    }).notNull(),
    method: varchar("method", { length: 30 }),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    /**
     * Kept in full, and deliberately NOT encrypted (ADR-025). It is retained precisely
     * so a signature can be re-verified during an investigation, which encryption in
     * place would work against. Access is restricted and logged (`docs/API/09`).
     */
    rawCallbackPayload: jsonb("raw_callback_payload"),
    /**
     * Nullable three-state: null before verification, false for a forged callback,
     * true for a genuine one. A forged callback is RECORDED rather than dropped --
     * a spike in false is an alerting condition (`docs/DEVOPS/07`), and you cannot
     * alert on rows you threw away.
     */
    signatureValid: boolean("signature_valid"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * THE idempotency mechanism (`docs/DATABASE/08` § Critical Notes). A webhook
     * delivered twice hits this and does not create a second payment row; the service
     * upserts with ON CONFLICT DO NOTHING and then reads the existing status.
     *
     * Scoped to (provider, reference) rather than reference alone, because two
     * providers may legitimately issue the same reference string.
     */
    uniqueIndex("idx_payments_provider_ref").on(
      t.provider,
      t.providerReferenceId,
    ),
    index("idx_payments_order").on(t.orderId),
    check(
      "payments_status_check",
      sql`status IN ('pending', 'success', 'failed')`,
    ),
  ],
);

/**
 * Admin action audit trail. Append-only.
 *
 * "Append-only" is enforced by REVOKEing UPDATE and DELETE from the application role
 * in the migration, not by convention -- `docs/DATABASE/10` § Policy asks for the
 * permission level "where possible", and it is possible here. An audit trail that the
 * application can rewrite is not an audit trail.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => users.id),
    action: varchar("action", { length: 60 }).notNull(),
    resourceType: varchar("resource_type", { length: 40 }).notNull(),
    /** No FK: the target may be any table, and may itself have been deleted. */
    resourceId: uuid("resource_id").notNull(),
    reason: text("reason"),
    /**
     * Only the relevant fields, never the whole row (`docs/DATABASE/10` § Policy) --
     * copying an entire record here would duplicate bank account data into a second
     * place with a two-year retention.
     */
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    /** INET, a real address type rather than a string. */
    ipAddress: inet("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_audit_admin").on(t.adminId),
    index("idx_audit_resource").on(t.resourceType, t.resourceId),
    index("idx_audit_created").on(t.createdAt),
  ],
);
