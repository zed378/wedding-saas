import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  date,
  time,
  text,
  integer,
  bigint,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  unique,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";

import { users } from "./users.ts";
import { templates, templateVersions, media } from "./templates.ts";

/**
 * The invitation aggregate. `docs/DATABASE/04`, `05`, the invitation children of `06`,
 * `09` and `11`.
 *
 * Two directions of referential rule meet here and they are opposites on purpose:
 * everything an invitation OWNS cascades away with it, and everything an invitation
 * DEPENDS ON refuses to be deleted while it is in use. Getting either backwards is how
 * a live wedding page breaks.
 */

/**
 * The parent.
 *
 * owner_id, template_id and template_version_id are all ON DELETE RESTRICT: an
 * invitation must never disappear, or start rendering from a different structure,
 * because a row it points at was deleted elsewhere (BR-3.3, `docs/DATABASE/01`).
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** For users with several invitations. Never public. */
    internalName: varchar("internal_name", { length: 150 }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "restrict" }),
    templateVersionId: uuid("template_version_id")
      .notNull()
      .references(() => templateVersions.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    /**
     * Nullable: a draft has no address yet. Uniqueness comes from the partial index
     * below and NOT from a column-level UNIQUE -- see ADR-033, which is the same
     * correction ADR-031 made to users.email.
     */
    slug: varchar("slug", { length: 50 }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    expiryDate: date("expiry_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_invitations_owner").on(t.ownerId),
    /**
     * Live invitations only. `docs/DATABASE/04` § Notes says so in words: "a slug can
     * be reused after the old invitation is truly deleted". A column-level UNIQUE
     * would make that sentence false.
     */
    uniqueIndex("idx_invitations_slug")
      .on(t.slug)
      .where(sql`deleted_at IS NULL`),
    index("idx_invitations_status").on(t.status),
    check(
      "invitations_status_check",
      sql`status IN ('draft', 'pending_payment', 'paid', 'published', 'expired', 'soft_deleted')`,
    ),
  ],
);

/**
 * Per-invitation display and privacy settings. PK is the FK, so the 1..1 is structural.
 */
export const invitationSettings = pgTable("invitation_settings", {
  invitationId: uuid("invitation_id")
    .primaryKey()
    .references(() => invitations.id, { onDelete: "cascade" }),
  enabledSections: varchar("enabled_sections", { length: 40 })
    .array()
    .notNull()
    .default(sql`'{}'`),
  themeOverride: jsonb("theme_override")
    .notNull()
    .default(sql`'{}'::jsonb`),
  rsvpEnabled: boolean("rsvp_enabled").notNull().default(true),
  guestbookEnabled: boolean("guestbook_enabled").notNull().default(true),
  /** Off by default; the service flips new entries to 'pending' when this is on. */
  guestbookModeration: boolean("guestbook_moderation").notNull().default(false),
  /**
   * FALSE by default, and that default is the privacy decision in `docs/PLAN/15`.
   * A wedding invitation carries names, addresses, times and a guest list; it must
   * not enter a search index because nobody thought to turn indexing off.
   */
  seoIndexable: boolean("seo_indexable").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The lifecycle audit trail.
 *
 * Written by the service layer, never by a database trigger -- `docs/DATABASE/04` is
 * explicit about this, because `changed_by` and `reason` come from application context
 * that a trigger cannot see. `P0-14` builds the writer.
 */
export const invitationStatusHistory = pgTable(
  "invitation_status_history",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    /** Null for the first transition into 'draft'. */
    fromStatus: varchar("from_status", { length: 20 }),
    toStatus: varchar("to_status", { length: 20 }).notNull(),
    /**
     * Nullable: an expiry sweep or a payment webhook changes status with no acting
     * user. NOT NULL would force a fake actor into the audit trail, which is worse
     * than an honest null.
     */
    changedBy: uuid("changed_by").references(() => users.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_status_history_invitation").on(t.invitationId)],
);

/**
 * Share-preview tokens. The only thing between an unpublished invitation and the open
 * internet, so treated as a credential: hashed, expiring, revocable.
 */
export const invitationPreviewTokens = pgTable(
  "invitation_preview_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_preview_tokens_hash").on(t.tokenHash),
    /** Partial: only live tokens, which is all a resolve ever looks for. */
    index("idx_preview_tokens_invitation")
      .on(t.invitationId)
      .where(sql`revoked_at IS NULL`),
  ],
);

/** Phase 7 feature, table created now so the schema matches the document. */
export const invitationCustomDomains = pgTable(
  "invitation_custom_domains",
  {
    invitationId: uuid("invitation_id")
      .primaryKey()
      .references(() => invitations.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 255 }).notNull().unique(),
    verificationStatus: varchar("verification_status", { length: 20 })
      .notNull()
      .default("pending_verification"),
    /** No CHECK, exactly as documented -- unlike verification_status beside it. */
    sslStatus: varchar("ssl_status", { length: 20 })
      .notNull()
      .default("pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  () => [
    check(
      "invitation_custom_domains_verification_status_check",
      sql`verification_status IN ('pending_verification', 'verified', 'active', 'failed')`,
    ),
  ],
);

/**
 * Groom and bride. Exactly two rows, enforced by UNIQUE (invitation_id, role) together
 * with the role CHECK -- `docs/DATABASE/05` § Notes calls this a deliberate match to
 * the domain rather than a generic N-person model.
 */
export const invitationPeople = pgTable(
  "invitation_people",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 10 }).notNull(),
    /** Defaults to '' rather than NULL: the row exists from creation, empty. */
    fullName: varchar("full_name", { length: 150 }).notNull().default(""),
    nickname: varchar("nickname", { length: 60 }).notNull().default(""),
    photoMediaId: uuid("photo_media_id").references(() => media.id),
    instagram: varchar("instagram", { length: 60 }),
    fatherName: varchar("father_name", { length: 150 }),
    motherName: varchar("mother_name", { length: 150 }),
    childOrder: varchar("child_order", { length: 60 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("invitation_people_invitation_id_role_unique").on(
      t.invitationId,
      t.role,
    ),
    check("invitation_people_role_check", sql`role IN ('groom', 'bride')`),
  ],
);

/** N events per invitation: akad, reception, and custom ones. */
export const invitationEvents = pgTable(
  "invitation_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull(),
    title: varchar("title", { length: 150 }).notNull(),
    eventDate: date("event_date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time"),
    venueName: varchar("venue_name", { length: 200 }).notNull(),
    address: text("address").notNull(),
    /**
     * DECIMAL(9,6), not a float. Six decimal places is roughly 0.1m and exact --
     * binary floating point would introduce drift into a value used to draw a pin on
     * a map and to build a directions link.
     */
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    /** Generated from lat/long at the service layer when left empty (`docs/BACKEND/02`). */
    mapsUrl: varchar("maps_url", { length: 500 }),
    description: text("description"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_events_invitation").on(t.invitationId),
    check(
      "invitation_events_type_check",
      sql`type IN ('akad', 'reception', 'custom')`,
    ),
  ],
);

/** Photos on the invitation, ordered, one of them the cover. */
export const invitationGallery = pgTable(
  "invitation_gallery",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    caption: varchar("caption", { length: 200 }),
    displayOrder: integer("display_order").notNull().default(0),
    isCover: boolean("is_cover").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_gallery_invitation").on(t.invitationId)],
);

/**
 * Gift destinations the couple publishes on their own invitation.
 *
 * NOT a platform payment credential -- ADR-025 and `docs/DATABASE/06` § Data Security.
 * The platform never transacts with these. They are displayed publicly by design when
 * the gift section is enabled, which is why the control that matters here is
 * INTEGRITY, not secrecy: an attacker who silently swaps the number collects every
 * guest's gift, and encryption would not have prevented that. Risk R16.
 */
export const invitationBankAccounts = pgTable("invitation_bank_accounts", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  invitationId: uuid("invitation_id")
    .notNull()
    .references(() => invitations.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 10 }).notNull(),
  providerName: varchar("provider_name", { length: 60 }).notNull(),
  accountNumber: varchar("account_number", { length: 60 }).notNull(),
  accountHolder: varchar("account_holder", { length: 150 }).notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One optional quote per invitation. */
export const invitationQuote = pgTable("invitation_quote", {
  invitationId: uuid("invitation_id")
    .primaryKey()
    .references(() => invitations.id, { onDelete: "cascade" }),
  text: text("text"),
  source: varchar("source", { length: 200 }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * RSVP submissions. Written by anonymous guests through the public surface, so every
 * value here is untrusted input.
 */
export const invitationGuests = pgTable(
  "invitation_guests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    guestName: varchar("guest_name", { length: 150 }).notNull(),
    attendanceStatus: varchar("attendance_status", { length: 15 }).notNull(),
    guestCount: integer("guest_count").notNull().default(1),
    /** Free text, sanitized before storage at the service layer (`docs/SECURITY/08`). */
    message: text("message"),
    /** A hash, never the raw IP (`docs/SECURITY/09`). */
    submittedIpHash: varchar("submitted_ip_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_guests_invitation").on(t.invitationId),
    check(
      "invitation_guests_attendance_status_check",
      sql`attendance_status IN ('attending', 'not_attending', 'maybe')`,
    ),
    /** A party of 1..10. Stops a typo or an abusive submission claiming 5000 seats. */
    check(
      "invitation_guests_guest_count_check",
      sql`guest_count BETWEEN 1 AND 10`,
    ),
  ],
);

/**
 * Public guestbook. `status` defaults to 'approved'; the service overrides it to
 * 'pending' when the invitation has moderation on (`docs/DATABASE/09` § Notes).
 */
export const invitationGuestbook = pgTable(
  "invitation_guestbook",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    guestName: varchar("guest_name", { length: 150 }).notNull(),
    /** Sanitized against HTML/script before storage -- stored XSS is the risk here. */
    message: text("message").notNull(),
    status: varchar("status", { length: 15 }).notNull().default("approved"),
    submittedIpHash: varchar("submitted_ip_hash", { length: 64 }),
    moderatedBy: uuid("moderated_by").references(() => users.id),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * Composite (invitation_id, status), named explicitly by `docs/ARCHITECTURE/04`
     * § Indexing: the moderation queue filters on both, and an index on
     * invitation_id alone would leave the status filter to a scan.
     */
    index("idx_guestbook_invitation").on(t.invitationId, t.status),
    check(
      "invitation_guestbook_status_check",
      sql`status IN ('pending', 'approved', 'rejected')`,
    ),
  ],
);

/**
 * Page views at daily grain, upserted by the flush job (`P4-09`).
 *
 * The composite primary key is what makes the upsert safe: one row per invitation per
 * day, so a concurrent flush conflicts rather than double-counting.
 */
export const invitationViewCounts = pgTable(
  "invitation_view_counts",
  {
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    viewDate: date("view_date").notNull(),
    /**
     * `sql` rather than a `0n` literal: drizzle-kit serialises the schema snapshot to
     * JSON and JSON.stringify throws on a BigInt, so a bigint default has to be
     * written as SQL. The column stays BIGINT as documented.
     */
    viewCount: bigint("view_count", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.invitationId, t.viewDate] }),
    index("idx_view_counts_invitation").on(t.invitationId),
  ],
);
