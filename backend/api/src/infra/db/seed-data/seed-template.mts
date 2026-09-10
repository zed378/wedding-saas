import type { Pool } from "pg";

import { assertValidTemplateVersion } from "@wi/schema";
import { mediaKey } from "@wi/storage";

import { loadDemoInvitation, loadReferenceTemplate } from "./load.mts";
import {
  DEMO_INVITATION_ID,
  DEMO_INVITATION_SLUG,
  SYSTEM_ACCOUNT_EMAIL,
  SYSTEM_ACCOUNT_ID,
} from "../../../shared/demo/demo-account.ts";

/**
 * P0-21 — seeding the reference template and its demo invitation.
 *
 * Separate from `seed.mts` so the integration suite can call these directly. Importing
 * `seed.mts` would run its `main()`, guards and all, at module load.
 */

/**
 * The reference template. `P0-21`.
 *
 * Read from `seed-data/reference-template.json` -- data, not code, which is
 * `docs/PLAN/07` § Core Principles as a file format rather than as a rule someone
 * remembers. Validated against the `P0-20` schema before it is written, because
 * `docs/DATABASE/03` § Schema Validation requires exactly that and the columns are
 * JSONB, so Postgres would accept anything at all.
 *
 * Idempotent on `templates.slug` and `(template_id, version)`, so re-running updates the
 * design in place rather than accumulating versions.
 */
export async function seedReferenceTemplate(pool: Pool): Promise<string> {
  const file = loadReferenceTemplate();

  // Throws with every problem listed if the file has drifted from the schema. The seed
  // is one of only two writers of this table today, and the other is the test factory.
  const definition = assertValidTemplateVersion({
    sections: file.sections,
    theme: file.theme,
    customizable_theme_keys: file.customizable_theme_keys,
  });

  const { rows: t } = await pool.query<{ id: string }>(
    `INSERT INTO templates (slug, name, category, is_premium, thumbnail_url, status)
     VALUES ($1, $2, $3, $4, NULL, $5)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       category = EXCLUDED.category,
       is_premium = EXCLUDED.is_premium,
       status = EXCLUDED.status,
       updated_at = now()
     RETURNING id`,
    [
      file.template.slug,
      file.template.name,
      file.template.category,
      file.template.is_premium,
      file.template.status,
    ],
  );
  const templateId = t[0]!.id;

  const { rows: v } = await pool.query<{ id: string }>(
    `INSERT INTO template_versions
       (template_id, version, sections, theme, customizable_theme_keys, changelog, status, released_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, now())
     ON CONFLICT (template_id, version) DO UPDATE SET
       sections = EXCLUDED.sections,
       theme = EXCLUDED.theme,
       customizable_theme_keys = EXCLUDED.customizable_theme_keys,
       changelog = EXCLUDED.changelog,
       status = EXCLUDED.status
     RETURNING id`,
    [
      templateId,
      file.version,
      JSON.stringify(definition.sections),
      JSON.stringify(definition.theme),
      definition.customizable_theme_keys,
      file.changelog,
      file.status,
    ],
  );

  console.log(
    `reference template seeded: ${file.template.slug}@${file.version} ` +
      `(${definition.sections.length} sections)`,
  );
  return v[0]!.id;
}

/**
 * The demo invitation. `P0-21`, shape decided by `docs/PLAN/07` § Demo Data.
 *
 * A real invitation in the real tables owned by a system account, so the catalogue demo
 * (`docs/UI-UX/11`) and the admin preview render through the production renderer reading
 * the production public API shape. A JSON fixture with a demo-only render path was
 * rejected there because it drifts, and a demo that has stopped resembling the product
 * is worse than no demo on the page whose job is setting expectations.
 *
 * Deleted and rewritten rather than upserted row by row. The child rows have no natural
 * key -- two events, six photos, three guestbook entries -- so an upsert would need
 * synthetic ids for every one of them to stay idempotent. `ON DELETE CASCADE` from
 * `invitations` already does the work; the invitation row itself keeps its fixed id so
 * nothing that references it breaks.
 */
export async function seedDemoInvitation(
  pool: Pool,
  templateVersionId: string,
): Promise<void> {
  const file = loadDemoInvitation();

  const { rows: tv } = await pool.query<{ template_id: string }>(
    "SELECT template_id FROM template_versions WHERE id = $1",
    [templateVersionId],
  );
  const templateId = tv[0]!.template_id;

  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, email_verified, status)
     VALUES ($1, $2, NULL, 'System (demo content)', 'user', true, 'active')
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`,
    [SYSTEM_ACCOUNT_ID, SYSTEM_ACCOUNT_EMAIL],
  );

  // Cascades to every child row. The invitation itself is re-inserted with the same id.
  await pool.query("DELETE FROM invitations WHERE id = $1", [
    DEMO_INVITATION_ID,
  ]);

  await pool.query(
    `INSERT INTO invitations
       (id, owner_id, internal_name, template_id, template_version_id, status, slug,
        published_at, expiry_date)
     VALUES ($1, $2, $3, $4, $5, 'published', $6, now(), $7)`,
    [
      DEMO_INVITATION_ID,
      SYSTEM_ACCOUNT_ID,
      file.internal_name,
      templateId,
      templateVersionId,
      DEMO_INVITATION_SLUG,
      // Far future. A demo that expires is a catalogue page that breaks on a date
      // nobody wrote down.
      "2099-12-31",
    ],
  );

  await pool.query(
    `INSERT INTO invitation_settings
       (invitation_id, enabled_sections, rsvp_enabled, guestbook_enabled,
        guestbook_moderation, seo_indexable)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      DEMO_INVITATION_ID,
      file.settings.enabled_sections,
      file.settings.rsvp_enabled,
      file.settings.guestbook_enabled,
      file.settings.guestbook_moderation,
      // false. The demo is reachable, never indexed (docs/UI-UX/11).
      file.settings.seo_indexable,
    ],
  );

  for (const person of file.people) {
    await pool.query(
      `INSERT INTO invitation_people
         (invitation_id, role, full_name, nickname, instagram, father_name,
          mother_name, child_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        DEMO_INVITATION_ID,
        person["role"],
        person["full_name"],
        person["nickname"],
        person["instagram"],
        person["father_name"],
        person["mother_name"],
        person["child_order"],
      ],
    );
  }

  for (const event of file.events) {
    await pool.query(
      `INSERT INTO invitation_events
         (invitation_id, type, title, event_date, start_time, end_time, venue_name,
          address, latitude, longitude, description, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        DEMO_INVITATION_ID,
        event["type"],
        event["title"],
        event["event_date"],
        event["start_time"],
        event["end_time"],
        event["venue_name"],
        event["address"],
        event["latitude"],
        event["longitude"],
        event["description"],
        event["display_order"],
      ],
    );
  }

  await pool.query(
    "INSERT INTO invitation_quote (invitation_id, text, source) VALUES ($1, $2, $3)",
    [DEMO_INVITATION_ID, file.quote.text, file.quote.source],
  );

  for (const account of file.gift_accounts) {
    await pool.query(
      `INSERT INTO invitation_bank_accounts
         (invitation_id, type, provider_name, account_number, account_holder, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        DEMO_INVITATION_ID,
        account["type"],
        account["provider_name"],
        account["account_number"],
        account["account_holder"],
        account["display_order"],
      ],
    );
  }

  // Media rows, but NOT the objects they point at. The storage keys are built by
  // @wi/storage so they are the same keys the upload pipeline will write to (P1-16) --
  // seeding a path by hand here would create the one place in the system where a
  // storage key is invented, which is what scripts/check-storage-paths.mjs exists to
  // prevent. Until an image is actually uploaded, the demo page shows broken images;
  // that is written in demo-invitation.json beside the gallery rather than left to be
  // discovered.
  for (const photo of file.gallery) {
    const { rows: m } = await pool.query<{ id: string }>(
      `INSERT INTO media (invitation_id, uploaded_by, purpose, status, storage_path,
                          mime_type, width, height, size_bytes)
       VALUES ($1, $2, 'gallery', 'ready', '', 'image/webp', 1600, 1067, 240000)
       RETURNING id`,
      [DEMO_INVITATION_ID, SYSTEM_ACCOUNT_ID],
    );
    const mediaId = m[0]!.id;

    await pool.query("UPDATE media SET storage_path = $2 WHERE id = $1", [
      mediaId,
      mediaKey(DEMO_INVITATION_ID, mediaId, "large"),
    ]);

    await pool.query(
      `INSERT INTO invitation_gallery (invitation_id, media_id, caption, display_order, is_cover)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        DEMO_INVITATION_ID,
        mediaId,
        photo.caption,
        photo.display_order,
        photo.is_cover,
      ],
    );
  }

  for (const entry of file.guestbook) {
    await pool.query(
      `INSERT INTO invitation_guestbook (invitation_id, guest_name, message, status)
       VALUES ($1, $2, $3, $4)`,
      [
        DEMO_INVITATION_ID,
        entry["guest_name"],
        entry["message"],
        entry["status"],
      ],
    );
  }

  for (const guest of file.guests) {
    await pool.query(
      `INSERT INTO invitation_guests
         (invitation_id, guest_name, attendance_status, guest_count, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        DEMO_INVITATION_ID,
        guest["guest_name"],
        guest["attendance_status"],
        guest["guest_count"],
        guest["message"],
      ],
    );
  }

  console.log(
    `demo invitation seeded: /${DEMO_INVITATION_SLUG} ` +
      `(owner ${SYSTEM_ACCOUNT_ID}, not listed, not indexed)`,
  );
}
