import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

import { collectMissingRequiredFields, sectionsSchema } from "@wi/schema";

import {
  seedDemoInvitation,
  seedReferenceTemplate,
} from "../../src/infra/db/seed-data/seed-template.mts";
import {
  DEMO_INVITATION_ID,
  DEMO_INVITATION_SLUG,
  SYSTEM_ACCOUNT_ID,
} from "../../src/shared/demo/demo-account";
import { startHarness, type Harness } from "../support/harness";
import { resetTenantData } from "./helpers.ts";

/**
 * P0-21 — the seed against a real database.
 *
 * `test/reference-template.spec.ts` proves the *files* are coherent. This proves the
 * seed writes them, that running it twice is safe, and that what lands in the tables is
 * a publishable invitation rather than a set of rows that merely inserted without error.
 */

describe("seeding the reference template and demo", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  const seed = async (): Promise<string> => {
    const versionId = await seedReferenceTemplate(harness.pool);
    await seedDemoInvitation(harness.pool, versionId);
    return versionId;
  };

  it("writes one template, one version and one demo invitation", async () => {
    await seed();

    const counts = await harness.pool.query<{
      templates: string;
      versions: string;
      invitations: string;
    }>(
      `SELECT (SELECT count(*) FROM templates WHERE slug = 'elegant-rose')::text     AS templates,
              (SELECT count(*) FROM template_versions)::text                          AS versions,
              (SELECT count(*) FROM invitations WHERE id = $1)::text                  AS invitations`,
      [DEMO_INVITATION_ID],
    );

    expect(counts.rows[0]).toEqual({
      templates: "1",
      versions: "1",
      invitations: "1",
    });
  });

  it("is idempotent — running it twice leaves the same rows", async () => {
    // The seed is meant to be re-runnable (docs/PLAN/07 § Demo Data: "refreshed by the
    // same seed command that installs the reference template"). A second run that
    // accumulated a second version, or failed on a unique constraint, would make
    // refreshing the demo a manual database operation.
    await seed();
    const before = await snapshot();

    await seed();
    const after = await snapshot();

    expect(after).toEqual(before);
  });

  async function snapshot(): Promise<Record<string, string>> {
    const { rows } = await harness.pool.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM templates)::text                AS templates,
              (SELECT count(*) FROM template_versions)::text        AS versions,
              (SELECT count(*) FROM invitations)::text              AS invitations,
              (SELECT count(*) FROM invitation_people)::text        AS people,
              (SELECT count(*) FROM invitation_events)::text        AS events,
              (SELECT count(*) FROM invitation_gallery)::text       AS gallery,
              (SELECT count(*) FROM invitation_bank_accounts)::text AS accounts,
              (SELECT count(*) FROM invitation_guestbook)::text     AS guestbook,
              (SELECT count(*) FROM invitation_guests)::text        AS guests,
              (SELECT count(*) FROM media)::text                    AS media`,
    );
    return rows[0]!;
  }

  it("owns the demo with a system account that cannot be logged into", async () => {
    // docs/PLAN/07 § Demo Data picks ownership as the marker. A seeded account with a
    // known id and a usable credential would be a back door shipping with the product.
    await seed();

    const { rows } = await harness.pool.query<{
      id: string;
      password_hash: string | null;
      oauth_provider: string | null;
      email: string;
    }>(
      "SELECT id, password_hash, oauth_provider, email FROM users WHERE id = $1",
      [SYSTEM_ACCOUNT_ID],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.password_hash).toBeNull();
    expect(rows[0]!.oauth_provider).toBeNull();
    // RFC 2606 reserves .invalid, so a notification job that reaches it fails loudly
    // rather than mailing a stranger.
    expect(rows[0]!.email).toMatch(/\.invalid$/);
  });

  it("publishes the demo at a known slug, not indexed", async () => {
    await seed();

    const { rows } = await harness.pool.query<{
      status: string;
      slug: string;
      seo_indexable: boolean;
    }>(
      `SELECT i.status, i.slug, s.seo_indexable
         FROM invitations i JOIN invitation_settings s ON s.invitation_id = i.id
        WHERE i.id = $1`,
      [DEMO_INVITATION_ID],
    );

    expect(rows[0]).toEqual({
      status: "published",
      slug: DEMO_INVITATION_SLUG,
      seo_indexable: false,
    });
  });

  it("stores gallery media under keys the upload pipeline would produce", async () => {
    // Built by @wi/storage rather than written by hand -- the same builder P1-16 will
    // use, so the demo's rows are not a second path's idea of where an object lives.
    await seed();

    const { rows } = await harness.pool.query<{ storage_path: string }>(
      "SELECT storage_path FROM media WHERE invitation_id = $1",
      [DEMO_INVITATION_ID],
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.storage_path).toMatch(
        new RegExp(
          `^invitations/${DEMO_INVITATION_ID}/media/[0-9a-f-]{36}/large\\.webp$`,
        ),
      );
    }
  });

  it("seeds a demo that is publishable against its own template", async () => {
    // The end-to-end claim, read back out of the database rather than out of the JSON.
    // Assembled the way the public endpoint will assemble it (docs/API/08).
    const versionId = await seed();

    const { rows: v } = await harness.pool.query<{ sections: unknown }>(
      "SELECT sections FROM template_versions WHERE id = $1",
      [versionId],
    );
    const sections = sectionsSchema.parse(v[0]!.sections);

    const { rows: settings } = await harness.pool.query<{
      enabled_sections: string[];
    }>(
      "SELECT enabled_sections FROM invitation_settings WHERE invitation_id = $1",
      [DEMO_INVITATION_ID],
    );

    const data = await assembleInvitationData();

    const missing = collectMissingRequiredFields(
      sections,
      settings[0]!.enabled_sections,
      data,
    );

    expect(
      missing.map((m) => `${m.sectionKey}: ${m.path}`),
      "the seeded demo is not publishable against the seeded template",
    ).toEqual([]);
  });

  /** The shape docs/PLAN/08 describes, read from the tables the seed wrote. */
  async function assembleInvitationData(): Promise<unknown> {
    const people = await harness.pool.query(
      "SELECT role, full_name, nickname, photo_media_id, instagram, father_name, mother_name, child_order FROM invitation_people WHERE invitation_id = $1",
      [DEMO_INVITATION_ID],
    );
    const events = await harness.pool.query(
      "SELECT type, title, event_date, start_time, end_time, venue_name, address, latitude, longitude, maps_url, description FROM invitation_events WHERE invitation_id = $1 ORDER BY display_order",
      [DEMO_INVITATION_ID],
    );
    const gallery = await harness.pool.query(
      "SELECT media_id, caption, display_order, is_cover FROM invitation_gallery WHERE invitation_id = $1 ORDER BY display_order",
      [DEMO_INVITATION_ID],
    );
    const accounts = await harness.pool.query(
      "SELECT type, provider_name, account_number, account_holder, display_order FROM invitation_bank_accounts WHERE invitation_id = $1 ORDER BY display_order",
      [DEMO_INVITATION_ID],
    );
    const quote = await harness.pool.query(
      "SELECT text, source FROM invitation_quote WHERE invitation_id = $1",
      [DEMO_INVITATION_ID],
    );

    const person = (role: string) => {
      const p = people.rows.find((r) => r["role"] === role)!;
      return {
        full_name: p["full_name"],
        nickname: p["nickname"],
        photo: p["photo_media_id"],
        instagram: p["instagram"],
        father_name: p["father_name"],
        mother_name: p["mother_name"],
        child_order: p["child_order"],
      };
    };

    return {
      couple: { groom: person("groom"), bride: person("bride") },
      events: events.rows.map((e) => ({
        type: e["type"],
        title: e["title"],
        // `event_date` in the column, `date` in the canonical vocabulary.
        date: e["event_date"],
        start_time: e["start_time"],
        end_time: e["end_time"],
        venue_name: e["venue_name"],
        address: e["address"],
        latitude: e["latitude"],
        longitude: e["longitude"],
        maps_url: e["maps_url"],
        description: e["description"],
      })),
      gallery: {
        photos: gallery.rows.map((g) => ({
          media_id: g["media_id"],
          caption: g["caption"],
          order: g["display_order"],
          is_cover: g["is_cover"],
        })),
      },
      gift: {
        accounts: accounts.rows.map((a) => ({
          type: a["type"],
          provider_name: a["provider_name"],
          account_number: a["account_number"],
          account_holder: a["account_holder"],
          order: a["display_order"],
        })),
      },
      quote: {
        text: quote.rows[0]?.["text"],
        source: quote.rows[0]?.["source"],
      },
    };
  }
});
