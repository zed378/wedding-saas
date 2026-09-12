import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  unique,
  check,
} from "drizzle-orm/pg-core";

import { users } from "./users.ts";
// Circular by necessity: invitations.ts imports media/templates from here, and media
// references invitations. Drizzle's `.references(() => ...)` stores a callback rather
// than reading the table at module-evaluation time, so the cycle resolves. See ADR-032.
import { invitations } from "./invitations.ts";

/**
 * The template catalog and the media table. `docs/DATABASE/03-TEMPLATES.md` and the
 * `media` block of `docs/DATABASE/06-MEDIA.md`.
 *
 * Templates are data, not code (`docs/PLAN/07`, and the first non-negotiable rule in
 * CLAUDE.md). Everything a template needs lives in `template_versions.sections` and
 * `theme` as JSON, rendered by one generic renderer -- which is why those two columns
 * are JSONB rather than a set of typed tables.
 */

/**
 * A template. `status` moves draft -> published -> deprecated; it is never deleted
 * once a version of it is in use (BR-3.3).
 */
export const templates = pgTable(
  "templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: varchar("slug", { length: 80 }).notNull().unique(),
    name: varchar("name", { length: 100 }).notNull(),
    /**
     * A real Postgres array, not a join table. `docs/DATABASE/03` specifies
     * VARCHAR(40)[] and ADR-007 chose Drizzle partly because that type survives into
     * the migration instead of degrading to text[].
     */
    category: varchar("category", { length: 40 })
      .array()
      .notNull()
      .default(sql`'{}'`),
    isPremium: boolean("is_premium").notNull().default(false),
    thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  () => [
    check(
      "templates_status_check",
      sql`status IN ('draft', 'published', 'deprecated')`,
    ),
  ],
);

/**
 * An immutable-in-practice snapshot of a template's structure.
 *
 * ON DELETE RESTRICT from `templates`, deliberately not CASCADE: a cascade here would
 * silently remove the versions that already-published invitations render from, turning
 * a catalog tidy-up into broken wedding pages. BR-3.3 says deprecate instead.
 */
export const templateVersions = pgTable(
  "template_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "restrict" }),
    /** semver, e.g. '1.2.0'. A string, because it is an identifier and not a number. */
    version: varchar("version", { length: 20 }).notNull(),
    /**
     * The section list. Validated against a fixed JSON Schema in application code
     * before any write (`docs/DATABASE/03` § Schema Validation, `P0-20`) -- not by a
     * database CHECK, which could not be versioned alongside the validator.
     */
    sections: jsonb("sections").notNull(),
    theme: jsonb("theme").notNull(),
    customizableThemeKeys: varchar("customizable_theme_keys", { length: 60 })
      .array()
      .notNull()
      .default(sql`'{}'`),
    changelog: text("changelog"),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** No template may publish the same version number twice. */
    unique("template_versions_template_id_version_unique").on(
      t.templateId,
      t.version,
    ),
    index("idx_template_versions_template").on(t.templateId),
    check(
      "template_versions_status_check",
      sql`status IN ('draft', 'published', 'deprecated')`,
    ),
  ],
);

/**
 * Polymorphic media. `invitation_id` NULL is what distinguishes a template asset from
 * a user upload (`docs/DATABASE/00`).
 *
 * The `invitation_id` FOREIGN KEY was added one migration later than this table, by
 * `P0-09` -- `invitations` did not exist when `media` was created and `template_assets`
 * needed `media` immediately. ADR-032 records why; the end state matches
 * `docs/DATABASE/06` exactly.
 */
export const media = pgTable(
  "media",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /**
     * Nullable by design: NULL is what marks a row as a template asset rather than a
     * user upload. CASCADE, so deleting an invitation takes its media with it instead
     * of leaving rows pointing at nothing.
     */
    invitationId: uuid("invitation_id").references(() => invitations.id, {
      onDelete: "cascade",
    }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    purpose: varchar("purpose", { length: 30 }).notNull(),
    /**
     * Defaults to 'processing'. A row exists before the file has been through the
     * validation pipeline in `docs/SECURITY/06`, and nothing may treat it as usable
     * until that pipeline sets 'ready'. Defaulting to 'ready' would make a failed
     * scan invisible.
     */
    status: varchar("status", { length: 20 }).notNull().default("processing"),
    storagePath: varchar("storage_path", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 60 }),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_media_invitation").on(t.invitationId),
    check(
      "media_status_check",
      sql`status IN ('processing', 'ready', 'failed')`,
    ),
  ],
);

/**
 * Files a template version needs. CASCADE from the version, which is the opposite
 * rule to template_versions -> templates and is correct: an asset has no meaning
 * without the version that declares it.
 */
export const templateAssets = pgTable("template_assets", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  templateVersionId: uuid("template_version_id")
    .notNull()
    .references(() => templateVersions.id, { onDelete: "cascade" }),
  assetName: varchar("asset_name", { length: 100 }).notNull(),
  /**
   * Nullable and with no ON DELETE, exactly as documented: an asset can be declared
   * before its file is uploaded, and deleting media that a template still references
   * is refused rather than silently nulled.
   */
  mediaId: uuid("media_id").references(() => media.id),
  purpose: varchar("purpose", { length: 40 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The reserved-word and profanity blocklist. `docs/DATABASE/12-PLATFORM-CONFIG.md`.
 *
 * Data rather than a constant because `docs/SECURITY/10` § Slug Blocklist requires it to be
 * "managed by admins, updatable without a deploy". `P1-09` reads it on every slug
 * validation; `P5-13` gives admins the write path.
 *
 * It lives in this file rather than `invitations.ts` because it is platform configuration,
 * not tenant data -- nothing here belongs to a user, which is also why
 * `scripts/check-tenant-scope.mjs` has no opinion about importing it.
 */
export const slugBlocklist = pgTable(
  "slug_blocklist",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    term: varchar("term", { length: 60 }).notNull(),
    /** `exact` for reserved words, `substring` for profanity. See the document. */
    matchType: varchar("match_type", { length: 20 }).notNull().default("exact"),
    category: varchar("category", { length: 30 }).notNull().default("reserved"),
    reason: text("reason"),
    /** NULL for seeded system entries. Nobody typed them. */
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * On `lower(term)`, so `Admin` and `admin` cannot both exist and disagree about
     * whether the slug is allowed.
     */
    uniqueIndex("idx_slug_blocklist_term").on(
      sql`lower(${t.term})`,
      t.matchType,
    ),
    check(
      "slug_blocklist_match_type_check",
      sql`match_type IN ('exact','substring')`,
    ),
    check(
      "slug_blocklist_category_check",
      sql`category IN ('reserved','profanity','brand','other')`,
    ),
  ],
);
