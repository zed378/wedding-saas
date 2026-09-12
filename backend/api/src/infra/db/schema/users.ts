import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  customType,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";

/**
 * Users and the auth support tables. `docs/DATABASE/02-USERS.md`, column for column.
 *
 * ADR-007 chose Drizzle over Prisma specifically so that this file could stay close to
 * the SQL in that document -- partial unique indexes, CHECK constraints and exact
 * varchar lengths all survive the trip. Where something here differs from the document,
 * there is an ADR saying why; there is exactly one, ADR-031.
 *
 * Nothing in these tables may be logged (`docs/DEVOPS/06` § Mandatory Redaction).
 */

/** BYTEA. Drizzle has no first-class bytea, and the document is explicit about the type. */
const bytea = customType<{ data: Buffer; notNull: true }>({
  dataType: () => "bytea",
});

export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: varchar("email", { length: 255 }).notNull(),
    /**
     * Nullable, and that is load-bearing rather than lenient: an account created
     * through Google has no password, and a NOT NULL here would force a placeholder
     * hash that some later code path would inevitably try to verify against.
     */
    passwordHash: varchar("password_hash", { length: 255 }),
    fullName: varchar("full_name", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    role: varchar("role", { length: 20 }).notNull().default("user"),
    emailVerified: boolean("email_verified").notNull().default(false),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    oauthProvider: varchar("oauth_provider", { length: 20 }),
    oauthSubjectId: varchar("oauth_subject_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft delete. `docs/DATABASE/00` § Principles, and BR-9. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    /**
     * Unique among ACTIVE users only, and there is deliberately no column-level
     * UNIQUE beside it -- see ADR-031. A plain UNIQUE would cover soft-deleted rows
     * too, so an account that was deleted would hold its address hostage until the
     * hard delete ran days later, and the user would see a duplicate-key error they
     * could do nothing about.
     */
    uniqueIndex("idx_users_email")
      .on(t.email)
      .where(sql`deleted_at IS NULL`),

    /**
     * UNIQUE as of `P1-04` (ADR-049), which answers OQ-15.
     *
     * It was a plain index through `P0-07`, because `docs/API/01` matched an OAuth login
     * by verified Google email and subject id was only a lookup key -- making it unique
     * then would have invented a rule the documents do not state.
     *
     * `P1-04`'s step 3 changed that: "Match on (oauth_provider, oauth_subject_id)
     * **first**". A login key that can match two rows is a login whose outcome depends on
     * row order, and OQ-15 said so itself -- "a duplicate makes login ambiguous".
     *
     * Partial over active rows, like `idx_users_email` and for the same reason: a
     * soft-deleted account must not hold a Google identity hostage until the hard delete
     * runs.
     */
    uniqueIndex("idx_users_oauth")
      .on(t.oauthProvider, t.oauthSubjectId)
      .where(sql`oauth_provider IS NOT NULL AND deleted_at IS NULL`),

    /**
     * A role outside this set must be impossible, not merely unexpected. This is the
     * last line of defence behind every authorization check in the project: an
     * INSERT that sets role to something unrecognised should fail at the database
     * rather than produce an account whose privileges nobody has reasoned about.
     */
    check("users_role_check", sql`role IN ('user', 'admin', 'super_admin')`),
    check("users_status_check", sql`status IN ('active', 'suspended')`),
  ],
);

/**
 * One row per user, and the primary key IS the foreign key -- so "at most one
 * preferences row per user" is structural rather than a rule someone has to remember.
 */
export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    rsvpEmail: boolean("rsvp_email").notNull().default(true),
    guestbookEmail: boolean("guestbook_email").notNull().default(true),
    /** Defaults to false. Opt-in, not opt-out (`docs/SECURITY/09`). */
    marketingEmail: boolean("marketing_email").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * Rotating refresh tokens. Only the hash is stored: a database read must not yield a
 * usable credential (`docs/SECURITY/03`).
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_refresh_tokens_user").on(t.userId)],
);

/**
 * Single-use tokens for email verification (24h) and password reset (1h), per
 * `docs/SECURITY/03`. Hashed for the same reason refresh tokens are.
 *
 * The expiry durations live in application code, not here: a CHECK on expires_at
 * would fix the policy in the schema and make changing it a migration.
 */
export const userTokens = pgTable(
  "user_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 30 }).notNull(),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set on redemption, in the same transaction as the effect, so a replay is a no-op. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_user_tokens_hash").on(t.tokenHash),
    /**
     * Partial: only unused tokens. Issuing a new token of a type invalidates the
     * previous unused one, and this index is what makes "find the live token for
     * this user and type" cheap without scanning spent ones.
     */
    index("idx_user_tokens_user_type")
      .on(t.userId, t.type)
      .where(sql`used_at IS NULL`),
    check(
      "user_tokens_type_check",
      sql`type IN ('email_verification', 'password_reset')`,
    ),
  ],
);

/**
 * TOTP enrolment. Mandatory for admin and super_admin (`docs/SECURITY/03` § Admin
 * Session); the schema deliberately does not restrict by role, so MFA can be offered
 * to ordinary users later without a migration.
 */
export const userMfaFactors = pgTable(
  "user_mfa_factors",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull().default("totp"),
    /**
     * Application-layer encrypted, never plaintext. Disk encryption is not enough:
     * a TOTP secret readable from a database dump is a shared password.
     */
    secretEncrypted: bytea("secret_encrypted").notNull(),
    label: varchar("label", { length: 60 }),
    /** NULL until a first valid code is entered. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * One CONFIRMED factor per type, unconfirmed ones unlimited. The partial
     * predicate is the whole design: an enrolment that was started and abandoned
     * must not occupy the slot and lock an admin out of ever enrolling again.
     */
    uniqueIndex("idx_mfa_user_type")
      .on(t.userId, t.type)
      .where(sql`confirmed_at IS NOT NULL`),
    check("user_mfa_factors_type_check", sql`type IN ('totp')`),
  ],
);

/** Hashed, single-use. Regenerating the set invalidates every unused code. */
export const userRecoveryCodes = pgTable(
  "user_recovery_codes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: varchar("code_hash", { length: 255 }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_recovery_codes_user")
      .on(t.userId)
      .where(sql`used_at IS NULL`),
  ],
);
