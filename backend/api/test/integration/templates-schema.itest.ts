import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";

import { connect, tag } from "./helpers.ts";

/**
 * P0-08 — the template catalog and media constraints, proven by violating them.
 *
 * The asymmetry between the two delete rules is the point of most of this file:
 * `template_versions -> templates` is RESTRICT, `template_assets -> template_versions`
 * is CASCADE. Both are correct and they are opposites, which is exactly the kind of
 * thing that gets "tidied up" into consistency by someone who has not read BR-3.3.
 */

let pool: Pool;

async function insertTemplate(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row = { slug: `tpl-${tag()}`, name: "Classic", ...overrides };
  const cols = Object.keys(row);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO templates (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(row),
  );
  return rows[0]!.id;
}

async function insertVersion(
  templateId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row = {
    template_id: templateId,
    version: "1.0.0",
    sections: JSON.stringify([
      { section_key: "hero", component: "HeroClassic" },
    ]),
    theme: JSON.stringify({ "--color-primary": "#b76e79" }),
    ...overrides,
  };
  const cols = Object.keys(row);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO template_versions (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(row),
  );
  return rows[0]!.id;
}

async function insertMedia(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row = {
    purpose: "template_asset",
    storage_path: `assets/${tag()}.jpg`,
    ...overrides,
  };
  const cols = Object.keys(row);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO media (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(row),
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  pool = await connect([
    "templates",
    "template_versions",
    "media",
    "template_assets",
  ]);
});

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  // template_assets and template_versions cascade from templates; media does not
  // belong to a template, so it is cleared separately.
  await pool.query("DELETE FROM template_assets");
  await pool.query("DELETE FROM template_versions");
  await pool.query("DELETE FROM templates");
  await pool.query("DELETE FROM media");
});

describe("templates", () => {
  it("rejects a duplicate slug", async () => {
    const slug = `dup-${tag()}`;
    await insertTemplate({ slug });
    await expect(insertTemplate({ slug })).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("rejects a status outside the allowed set", async () => {
    await expect(insertTemplate({ status: "archived" })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("stores category as a real text array, not a string", async () => {
    // docs/DATABASE/03 specifies VARCHAR(40)[]. ADR-007 chose Drizzle over Prisma
    // partly because this type survives instead of degrading to text[].
    const id = await insertTemplate({ category: ["rustic", "minimalist"] });
    const { rows } = await pool.query<{ category: string[]; t: string }>(
      `SELECT t.category,
              (SELECT data_type FROM information_schema.columns
                WHERE table_name='templates' AND column_name='category') AS t
         FROM templates t WHERE t.id = $1`,
      [id],
    );
    expect(rows[0]!.category).toEqual(["rustic", "minimalist"]);
    expect(rows[0]!.t).toBe("ARRAY");
  });

  it("defaults category to an empty array and status to draft", async () => {
    const id = await insertTemplate();
    const { rows } = await pool.query(
      "SELECT category, status, is_premium FROM templates WHERE id = $1",
      [id],
    );
    expect(rows[0]).toEqual({
      category: [],
      status: "draft",
      is_premium: false,
    });
  });
});

describe("template_versions", () => {
  it("rejects a duplicate (template_id, version)", async () => {
    const tpl = await insertTemplate();
    await insertVersion(tpl, { version: "1.0.0" });
    await expect(
      insertVersion(tpl, { version: "1.0.0" }),
    ).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("allows the same version string under a different template", async () => {
    // Guards the wrong fix: a unique index on `version` alone would pass the test
    // above and stop every template after the first from having a 1.0.0.
    const a = await insertTemplate();
    const b = await insertTemplate();
    await insertVersion(a, { version: "1.0.0" });
    await expect(insertVersion(b, { version: "1.0.0" })).resolves.toEqual(
      expect.any(String),
    );
  });

  it("round-trips sections and theme as JSONB", async () => {
    const tpl = await insertTemplate();
    const sections = [
      {
        section_key: "hero",
        component: "HeroClassic",
        enabled_by_default: true,
      },
      { section_key: "gallery", component: "GalleryGrid", max_items: 20 },
    ];
    const id = await insertVersion(tpl, { sections: JSON.stringify(sections) });

    const { rows } = await pool.query<{ sections: unknown; t: string }>(
      `SELECT v.sections,
              (SELECT data_type FROM information_schema.columns
                WHERE table_name='template_versions' AND column_name='sections') AS t
         FROM template_versions v WHERE v.id = $1`,
      [id],
    );
    // Parsed structure, not a string: proves the column is jsonb and not text.
    expect(rows[0]!.sections).toEqual(sections);
    expect(rows[0]!.t).toBe("jsonb");
  });

  it("stores customizable_theme_keys as an array defaulting to empty", async () => {
    const tpl = await insertTemplate();
    const withKeys = await insertVersion(tpl, {
      version: "1.1.0",
      customizable_theme_keys: ["--color-primary", "--font-heading"],
    });
    const plain = await insertVersion(tpl, { version: "1.2.0" });

    const { rows } = await pool.query<{ id: string; k: string[] }>(
      "SELECT id, customizable_theme_keys AS k FROM template_versions WHERE id = ANY($1)",
      [[withKeys, plain]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.k]));
    expect(byId[withKeys]).toEqual(["--color-primary", "--font-heading"]);
    expect(byId[plain]).toEqual([]);
  });

  it("rejects a status outside the allowed set", async () => {
    const tpl = await insertTemplate();
    await expect(insertVersion(tpl, { status: "beta" })).rejects.toMatchObject({
      code: "23514",
    });
  });
});

describe("delete rules — RESTRICT and CASCADE are deliberately opposite", () => {
  it("refuses to delete a template that still has versions", async () => {
    // BR-3.3: a version in use is deprecated, never deleted. A CASCADE here would
    // silently remove the versions published invitations render from, turning a
    // catalog tidy-up into broken wedding pages.
    const tpl = await insertTemplate();
    await insertVersion(tpl);

    // SQLSTATE 23001 (restrict_violation), NOT 23503 (foreign_key_violation).
    // PostgreSQL distinguishes them: RESTRICT is checked immediately and raises
    // 23001, while NO ACTION defers to end-of-statement and raises 23503. Worth
    // asserting the exact code -- application code that maps only 23503 to a
    // friendly "still in use" message would let this one through as a 500.
    await expect(
      pool.query("DELETE FROM templates WHERE id = $1", [tpl]),
    ).rejects.toMatchObject({
      code: "23001",
    });
  });

  it("allows deleting a template with no versions", async () => {
    const tpl = await insertTemplate();
    await expect(
      pool.query("DELETE FROM templates WHERE id = $1", [tpl]),
    ).resolves.toBeTruthy();
  });

  it("cascades template assets away with their version", async () => {
    // The opposite rule, and correct: an asset has no meaning without the version
    // that declares it.
    const tpl = await insertTemplate();
    const version = await insertVersion(tpl);
    await pool.query(
      "INSERT INTO template_assets (template_version_id, asset_name) VALUES ($1, 'hero-bg.jpg')",
      [version],
    );

    await pool.query("DELETE FROM template_versions WHERE id = $1", [version]);

    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM template_assets WHERE template_version_id = $1",
      [version],
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("refuses to delete media that a template asset still references", async () => {
    const tpl = await insertTemplate();
    const version = await insertVersion(tpl);
    const mediaId = await insertMedia();
    await pool.query(
      "INSERT INTO template_assets (template_version_id, asset_name, media_id) VALUES ($1, 'bg.jpg', $2)",
      [version, mediaId],
    );

    // 23503 here, not 23001: template_assets.media_id is NO ACTION (the document
    // specifies no ON DELETE clause), and NO ACTION raises foreign_key_violation.
    // The two codes in this file are different on purpose -- see the test above.
    await expect(
      pool.query("DELETE FROM media WHERE id = $1", [mediaId]),
    ).rejects.toMatchObject({
      code: "23503",
    });
  });
});

describe("media", () => {
  it("accepts a null invitation_id — that is what makes a row a template asset", async () => {
    const id = await insertMedia({ purpose: "template_asset" });
    const { rows } = await pool.query<{ invitation_id: string | null }>(
      "SELECT invitation_id FROM media WHERE id = $1",
      [id],
    );
    expect(rows[0]!.invitation_id).toBeNull();
  });

  it("has the idx_media_invitation index", async () => {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_indexes WHERE tablename='media' AND indexname='idx_media_invitation'",
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("defaults status to processing", async () => {
    // Nothing may treat an upload as usable before the docs/SECURITY/06 pipeline has
    // run. Defaulting to 'ready' would make a failed scan invisible.
    const id = await insertMedia();
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM media WHERE id = $1",
      [id],
    );
    expect(rows[0]!.status).toBe("processing");
  });

  it("rejects a status outside the allowed set", async () => {
    await expect(insertMedia({ status: "scanned" })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("stores size_bytes as bigint, so a large file does not overflow", async () => {
    // INT would cap at ~2.1GB. The column is documented as BIGINT and this asserts
    // the type rather than the value, because an INT column would accept this value
    // and fail on a larger one much later.
    const id = await insertMedia({ size_bytes: "5000000000" });
    const { rows } = await pool.query<{ size_bytes: string; t: string }>(
      `SELECT m.size_bytes::text AS size_bytes,
              (SELECT data_type FROM information_schema.columns
                WHERE table_name='media' AND column_name='size_bytes') AS t
         FROM media m WHERE m.id = $1`,
      [id],
    );
    expect(rows[0]!.size_bytes).toBe("5000000000");
    expect(rows[0]!.t).toBe("bigint");
  });

  it("does not yet constrain invitation_id — P0-09 adds the foreign key (ADR-032)", async () => {
    // This test documents a known, temporary gap rather than approving of it. When
    // P0-09 adds the constraint this test must be REPLACED by one asserting a bad
    // invitation_id is rejected. Leaving it passing after P0-09 would mean the
    // constraint never landed.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage k USING (constraint_name)
        WHERE tc.table_name = 'media'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND k.column_name = 'invitation_id'`,
    );
    expect(rows[0]!.n).toBe("0");
  });
});

describe("updated_at trigger", () => {
  it("templates bumps updated_at on a real change and not on a no-op", async () => {
    const id = await insertTemplate();
    const read = async () => {
      const { rows } = await pool.query<{ u: string }>(
        "SELECT updated_at::text AS u FROM templates WHERE id = $1",
        [id],
      );
      return rows[0]!.u;
    };

    const before = await read();
    await pool.query("UPDATE templates SET name = name WHERE id = $1", [id]);
    expect(await read()).toBe(before);

    await pool.query("UPDATE templates SET name = 'Renamed' WHERE id = $1", [
      id,
    ]);
    expect(await read()).not.toBe(before);
  });
});
