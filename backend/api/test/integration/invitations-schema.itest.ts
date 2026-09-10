import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";

import { connect, tag } from "./helpers.ts";

/**
 * P0-09 — the invitation aggregate's constraints, proven by violating them.
 *
 * Two directions of referential rule meet in this schema and they are opposites:
 * everything an invitation OWNS cascades away with it, everything an invitation
 * DEPENDS ON refuses deletion while in use. Both directions are tested, because
 * getting either backwards breaks a live wedding page and neither is visible from
 * reading the migration.
 */

let pool: Pool;

/** A whole valid invitation: owner, template, version, invitation. */
async function scaffold(
  invitationOverrides: Record<string, unknown> = {},
): Promise<{
  userId: string;
  templateId: string;
  versionId: string;
  invitationId: string;
}> {
  const { rows: u } = await pool.query<{ id: string }>(
    "INSERT INTO users (email, full_name) VALUES ($1, 'Owner') RETURNING id",
    [`owner-${tag()}@example.test`],
  );
  const userId = u[0]!.id;

  const { rows: t } = await pool.query<{ id: string }>(
    "INSERT INTO templates (slug, name) VALUES ($1, 'Classic') RETURNING id",
    [`tpl-${tag()}`],
  );
  const templateId = t[0]!.id;

  const { rows: v } = await pool.query<{ id: string }>(
    "INSERT INTO template_versions (template_id, version, sections, theme) VALUES ($1, '1.0.0', '[]'::jsonb, '{}'::jsonb) RETURNING id",
    [templateId],
  );
  const versionId = v[0]!.id;

  const row = {
    owner_id: userId,
    template_id: templateId,
    template_version_id: versionId,
    ...invitationOverrides,
  };
  const cols = Object.keys(row);
  const { rows: i } = await pool.query<{ id: string }>(
    `INSERT INTO invitations (${cols.join(", ")}) VALUES (${cols.map((_, n) => `$${n + 1}`).join(", ")}) RETURNING id`,
    Object.values(row),
  );

  return { userId, templateId, versionId, invitationId: i[0]!.id };
}

beforeAll(async () => {
  pool = await connect([
    "invitations",
    "invitation_settings",
    "invitation_status_history",
    "invitation_preview_tokens",
    "invitation_custom_domains",
    "invitation_people",
    "invitation_events",
    "invitation_gallery",
    "invitation_bank_accounts",
    "invitation_quote",
    "invitation_guests",
    "invitation_guestbook",
    "invitation_view_counts",
  ]);
});

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  // Order matters: invitations RESTRICTs from users and templates, so it goes first.
  // Its own children cascade, and so does media once its invitation is gone.
  await pool.query("DELETE FROM invitations");
  await pool.query("DELETE FROM media");
  await pool.query("DELETE FROM template_versions");
  await pool.query("DELETE FROM templates");
  await pool.query("DELETE FROM users");
});

describe("invitations — slug uniqueness (ADR-033)", () => {
  it("rejects a duplicate slug among live invitations", async () => {
    const slug = `wedding-${tag()}`;
    await scaffold({ slug });
    await expect(scaffold({ slug })).rejects.toMatchObject({ code: "23505" });
  });

  it("frees the slug once the invitation is soft-deleted", async () => {
    // docs/DATABASE/04 § Notes says this in words: "a slug can be reused after the
    // old invitation is truly deleted". A column-level UNIQUE would make that
    // sentence false, which is what ADR-033 removed.
    const slug = `reuse-${tag()}`;
    const first = await scaffold({ slug });
    await pool.query(
      "UPDATE invitations SET deleted_at = now() WHERE id = $1",
      [first.invitationId],
    );

    await expect(scaffold({ slug })).resolves.toBeTruthy();
  });

  it("still refuses a third live invitation on a twice-used slug", async () => {
    // Guards the wrong fix: dropping uniqueness entirely would pass the test above
    // and let two live invitations answer on the same public address.
    const slug = `triple-${tag()}`;
    const first = await scaffold({ slug });
    await pool.query(
      "UPDATE invitations SET deleted_at = now() WHERE id = $1",
      [first.invitationId],
    );
    await scaffold({ slug });

    await expect(scaffold({ slug })).rejects.toMatchObject({ code: "23505" });
  });

  it("allows many invitations with no slug at all", async () => {
    // Drafts have no address yet. NULLs do not collide in a unique index, and this
    // asserts that rather than trusting it.
    await scaffold();
    await scaffold();
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM invitations WHERE slug IS NULL",
    );
    expect(rows[0]!.n).toBe("2");
  });

  it("rejects a status outside the lifecycle", async () => {
    await expect(scaffold({ status: "archived" })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it.each([
    "draft",
    "pending_payment",
    "paid",
    "published",
    "expired",
    "soft_deleted",
  ])("accepts the documented status %s", async (status) => {
    await expect(scaffold({ status })).resolves.toBeTruthy();
  });
});

describe("dependencies refuse deletion while in use", () => {
  it("refuses to delete a user who still owns an invitation", async () => {
    const { userId } = await scaffold();
    await expect(
      pool.query("DELETE FROM users WHERE id = $1", [userId]),
    ).rejects.toMatchObject({
      code: "23001",
    });
  });

  it("refuses to delete a template version an invitation still uses", async () => {
    // BR-3.3. This is the invitation-side half of the rule that P0-08 could only
    // test from the template side, because invitations did not exist yet.
    const { versionId } = await scaffold();
    await expect(
      pool.query("DELETE FROM template_versions WHERE id = $1", [versionId]),
    ).rejects.toMatchObject({ code: "23001" });
  });

  it("refuses to delete a template an invitation still uses", async () => {
    const { templateId } = await scaffold();
    await expect(
      pool.query("DELETE FROM templates WHERE id = $1", [templateId]),
    ).rejects.toMatchObject({ code: "23001" });
  });
});

describe("children cascade away with their invitation", () => {
  it.each([
    [
      "invitation_settings",
      "INSERT INTO invitation_settings (invitation_id) VALUES ($1)",
    ],
    [
      "invitation_status_history",
      "INSERT INTO invitation_status_history (invitation_id, to_status) VALUES ($1, 'draft')",
    ],
    [
      "invitation_people",
      "INSERT INTO invitation_people (invitation_id, role) VALUES ($1, 'groom')",
    ],
    [
      "invitation_events",
      "INSERT INTO invitation_events (invitation_id, type, title, event_date, start_time, venue_name, address) VALUES ($1, 'akad', 'Akad', '2027-01-01', '09:00', 'Masjid', 'Jl. Contoh')",
    ],
    [
      "invitation_bank_accounts",
      "INSERT INTO invitation_bank_accounts (invitation_id, type, provider_name, account_number, account_holder) VALUES ($1, 'bank', 'BCA', '1234567890', 'A B')",
    ],
    [
      "invitation_quote",
      "INSERT INTO invitation_quote (invitation_id, text) VALUES ($1, 'Q')",
    ],
    [
      "invitation_guests",
      "INSERT INTO invitation_guests (invitation_id, guest_name, attendance_status) VALUES ($1, 'Guest', 'attending')",
    ],
    [
      "invitation_guestbook",
      "INSERT INTO invitation_guestbook (invitation_id, guest_name, message) VALUES ($1, 'Guest', 'Congrats')",
    ],
    [
      "invitation_preview_tokens",
      "INSERT INTO invitation_preview_tokens (invitation_id, token_hash, created_by, expires_at) VALUES ($1, 'h', $2, now() + interval '7 days')",
    ],
    [
      "invitation_custom_domains",
      "INSERT INTO invitation_custom_domains (invitation_id, domain) VALUES ($1, 'example.test')",
    ],
    [
      "invitation_view_counts",
      "INSERT INTO invitation_view_counts (invitation_id, view_date, view_count) VALUES ($1, CURRENT_DATE, 5)",
    ],
  ])("cascades %s away with its invitation", async (table, insert) => {
    const { invitationId, userId } = await scaffold();
    const params = insert.includes("$2")
      ? [invitationId, userId]
      : [invitationId];
    await pool.query(insert, params);

    await pool.query("DELETE FROM invitations WHERE id = $1", [invitationId]);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE invitation_id = $1`,
      [invitationId],
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("cascades media and gallery rows away with the invitation (ADR-032)", async () => {
    // The deferred foreign key from P0-08, now in force. Without it, deleting an
    // invitation would leave media rows pointing at nothing.
    const { invitationId, userId } = await scaffold();
    const { rows: m } = await pool.query<{ id: string }>(
      "INSERT INTO media (invitation_id, uploaded_by, purpose, storage_path) VALUES ($1, $2, 'gallery', 'p/1.jpg') RETURNING id",
      [invitationId, userId],
    );
    await pool.query(
      "INSERT INTO invitation_gallery (invitation_id, media_id) VALUES ($1, $2)",
      [invitationId, m[0]!.id],
    );

    await pool.query("DELETE FROM invitations WHERE id = $1", [invitationId]);

    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM media WHERE id = $1",
      [m[0]!.id],
    );
    expect(rows[0]!.n).toBe("0");
  });
});

describe("media.invitation_id foreign key (ADR-032, added here)", () => {
  it("rejects an invitation_id that references nothing", async () => {
    // This REPLACES the P0-08 test that asserted the constraint was absent. If that
    // test still exists and still passes, the ALTER never landed.
    await expect(
      pool.query(
        "INSERT INTO media (invitation_id, purpose, storage_path) VALUES (gen_random_uuid(), 'gallery', 'p/x.jpg')",
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("still accepts a null invitation_id for template assets", async () => {
    await expect(
      pool.query(
        "INSERT INTO media (purpose, storage_path) VALUES ('template_asset', 'assets/x.jpg')",
      ),
    ).resolves.toBeTruthy();
  });
});

describe("invitation_people — exactly two, groom and bride", () => {
  it("rejects a second row with the same role", async () => {
    const { invitationId } = await scaffold();
    const insert =
      "INSERT INTO invitation_people (invitation_id, role) VALUES ($1, $2)";
    await pool.query(insert, [invitationId, "groom"]);

    await expect(
      pool.query(insert, [invitationId, "groom"]),
    ).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("rejects a third person on one invitation", async () => {
    // Two constraints together produce the cap: UNIQUE (invitation_id, role) plus a
    // CHECK limiting role to two values. Neither alone would do it.
    const { invitationId } = await scaffold();
    const insert =
      "INSERT INTO invitation_people (invitation_id, role) VALUES ($1, $2)";
    await pool.query(insert, [invitationId, "groom"]);
    await pool.query(insert, [invitationId, "bride"]);

    await expect(
      pool.query(insert, [invitationId, "witness"]),
    ).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("allows the same role under different invitations", async () => {
    const a = await scaffold();
    const b = await scaffold();
    const insert =
      "INSERT INTO invitation_people (invitation_id, role) VALUES ($1, 'groom')";
    await pool.query(insert, [a.invitationId]);
    await expect(pool.query(insert, [b.invitationId])).resolves.toBeTruthy();
  });
});

describe("invitation_guests — RSVP input is untrusted", () => {
  const insert =
    "INSERT INTO invitation_guests (invitation_id, guest_name, attendance_status, guest_count) VALUES ($1, 'Guest', 'attending', $2)";

  it.each([0, 11, 5000, -1])("rejects a guest_count of %i", async (count) => {
    const { invitationId } = await scaffold();
    await expect(
      pool.query(insert, [invitationId, count]),
    ).rejects.toMatchObject({
      code: "23514",
    });
  });

  it.each([1, 5, 10])("accepts a guest_count of %i", async (count) => {
    const { invitationId } = await scaffold();
    await expect(
      pool.query(insert, [invitationId, count]),
    ).resolves.toBeTruthy();
  });

  it("rejects an attendance_status outside the allowed set", async () => {
    const { invitationId } = await scaffold();
    await expect(
      pool.query(
        "INSERT INTO invitation_guests (invitation_id, guest_name, attendance_status) VALUES ($1, 'G', 'perhaps')",
        [invitationId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("invitation_settings — privacy defaults", () => {
  it("defaults seo_indexable to false", async () => {
    // docs/PLAN/15. A wedding invitation carries names, addresses, times and a guest
    // list. It must not enter a search index because nobody thought to turn it off.
    const { invitationId } = await scaffold();
    await pool.query(
      "INSERT INTO invitation_settings (invitation_id) VALUES ($1)",
      [invitationId],
    );

    const { rows } = await pool.query(
      "SELECT seo_indexable, rsvp_enabled, guestbook_enabled, guestbook_moderation, enabled_sections FROM invitation_settings WHERE invitation_id = $1",
      [invitationId],
    );
    expect(rows[0]).toEqual({
      seo_indexable: false,
      rsvp_enabled: true,
      guestbook_enabled: true,
      guestbook_moderation: false,
      enabled_sections: [],
    });
  });
});

describe("invitation_status_history", () => {
  it("accepts a null changed_by, because system jobs have no acting user", async () => {
    // NOT NULL here would force a fake actor into the audit trail, which is worse
    // than an honest null.
    const { invitationId } = await scaffold();
    await expect(
      pool.query(
        "INSERT INTO invitation_status_history (invitation_id, from_status, to_status, reason) VALUES ($1, 'published', 'expired', 'expiry sweep')",
        [invitationId],
      ),
    ).resolves.toBeTruthy();
  });

  it("accepts a null from_status for the first transition", async () => {
    const { invitationId } = await scaffold();
    await expect(
      pool.query(
        "INSERT INTO invitation_status_history (invitation_id, to_status) VALUES ($1, 'draft')",
        [invitationId],
      ),
    ).resolves.toBeTruthy();
  });
});

describe("invitation_guestbook", () => {
  it("has the composite (invitation_id, status) index the moderation queue needs", async () => {
    // docs/ARCHITECTURE/04 § Indexing names this explicitly. An index on
    // invitation_id alone would leave the status filter to a scan.
    const { rows } = await pool.query<{ def: string }>(
      "SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'idx_guestbook_invitation'",
    );
    expect(rows[0]!.def).toMatch(/\(invitation_id, status\)/);
  });

  it("defaults status to approved", async () => {
    const { invitationId } = await scaffold();
    const { rows } = await pool.query<{ status: string }>(
      "INSERT INTO invitation_guestbook (invitation_id, guest_name, message) VALUES ($1, 'G', 'Hi') RETURNING status",
      [invitationId],
    );
    expect(rows[0]!.status).toBe("approved");
  });
});

describe("invitation_custom_domains and view counts", () => {
  it("rejects a duplicate custom domain", async () => {
    const a = await scaffold();
    const b = await scaffold();
    const domain = `d-${tag()}.example`;
    await pool.query(
      "INSERT INTO invitation_custom_domains (invitation_id, domain) VALUES ($1, $2)",
      [a.invitationId, domain],
    );
    await expect(
      pool.query(
        "INSERT INTO invitation_custom_domains (invitation_id, domain) VALUES ($1, $2)",
        [b.invitationId, domain],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects a duplicate (invitation_id, view_date)", async () => {
    // The composite primary key is what makes the P4-09 flush upsert safe: a
    // concurrent flush conflicts rather than double-counting.
    const { invitationId } = await scaffold();
    const insert =
      "INSERT INTO invitation_view_counts (invitation_id, view_date, view_count) VALUES ($1, CURRENT_DATE, 1)";
    await pool.query(insert, [invitationId]);
    await expect(pool.query(insert, [invitationId])).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("stores view_count as bigint", async () => {
    const { rows } = await pool.query<{ t: string }>(
      "SELECT data_type AS t FROM information_schema.columns WHERE table_name='invitation_view_counts' AND column_name='view_count'",
    );
    expect(rows[0]!.t).toBe("bigint");
  });
});

describe("invitation_events", () => {
  it("stores coordinates as exact decimals, not floats", async () => {
    // DECIMAL(9,6) is exact to ~0.1m. A float would drift, in a value used to place
    // a map pin and build a directions link.
    const { invitationId } = await scaffold();
    const { rows } = await pool.query<{ latitude: string; longitude: string }>(
      `INSERT INTO invitation_events
         (invitation_id, type, title, event_date, start_time, venue_name, address, latitude, longitude)
       VALUES ($1, 'reception', 'Resepsi', '2027-05-20', '19:00', 'Ballroom', 'Jl. Contoh 1', -6.914744, 107.609810)
       RETURNING latitude::text, longitude::text`,
      [invitationId],
    );
    expect(rows[0]!.latitude).toBe("-6.914744");
    expect(rows[0]!.longitude).toBe("107.609810");
  });

  it("rejects an event type outside the allowed set", async () => {
    const { invitationId } = await scaffold();
    await expect(
      pool.query(
        "INSERT INTO invitation_events (invitation_id, type, title, event_date, start_time, venue_name, address) VALUES ($1, 'afterparty', 'X', '2027-01-01', '09:00', 'V', 'A')",
        [invitationId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("updated_at triggers", () => {
  it("invitations bumps updated_at on a real change and not on a no-op", async () => {
    const { invitationId } = await scaffold();
    const read = async () => {
      const { rows } = await pool.query<{ u: string }>(
        "SELECT updated_at::text AS u FROM invitations WHERE id = $1",
        [invitationId],
      );
      return rows[0]!.u;
    };

    const before = await read();
    await pool.query("UPDATE invitations SET status = status WHERE id = $1", [
      invitationId,
    ]);
    expect(await read()).toBe(before);

    await pool.query(
      "UPDATE invitations SET status = 'published' WHERE id = $1",
      [invitationId],
    );
    expect(await read()).not.toBe(before);
  });

  it("every table with updated_at has a trigger maintaining it", async () => {
    // Catches the failure this project is most likely to repeat: adding a table with
    // updated_at and forgetting the trigger, after which the column silently reports
    // creation time forever.
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT c.table_name
         FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.column_name = 'updated_at'
          AND NOT EXISTS (
                SELECT 1 FROM information_schema.triggers t
                 WHERE t.event_object_table = c.table_name
                   AND t.action_statement LIKE '%set_updated_at%')`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});
