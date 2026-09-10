import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

import {
  startHarness,
  resetDatabase,
  appliedMigrationCount,
  journalMigrationCount,
  type Harness,
} from "../support/harness";
import {
  createTestUser,
  createTestInvitation,
  createTestTemplateVersion,
  createTestOrder,
  createTestMedia,
  createTwoTenants,
} from "../support/factories";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import * as schema from "../../src/infra/db/schema/index";

/**
 * P0-19 — the harness, the factories, and the demonstration IDOR test.
 *
 * The last of those is the point of the whole task. `docs/SECURITY/05` requires an IDOR
 * test for EVERY `:id` endpoint with zero tolerance for regressions, and the thing that
 * decides whether those tests get written is not diligence — it is whether the setup is
 * one line or twenty.
 */

let harness: Harness;
let repo: InvitationRepository;

beforeAll(async () => {
  harness = await startHarness();
  repo = new InvitationRepository(drizzle(harness.pool, { schema }));
}, 120_000);

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await resetDatabase(harness.pool);
});

describe("the harness itself", () => {
  it("applies every migration in the journal", async () => {
    // A suite running one migration behind produces failures that look like bugs in the
    // code under test, and the hour is spent in the wrong file.
    expect(await appliedMigrationCount(harness.pool)).toBe(
      journalMigrationCount(),
    );
  });

  it("seeds the master price tables", async () => {
    // packages/addons are seed data, not a migration (P0-10). Without them every order
    // test fails on a missing 'standard' package — a failure that reads as a schema bug.
    const { rows } = await harness.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM packages WHERE id = 'standard'",
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("gives each test a clean database", async () => {
    // Run twice, same result — the DoD's "a run repeated twice gives the same result".
    await createTestUser(harness.pool);
    const { rows } = await harness.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM users",
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("gives each test a clean database, again", async () => {
    // Deliberately identical to the test above. If isolation were broken this would see
    // two users, and the duplication is what makes that visible rather than subtle.
    await createTestUser(harness.pool);
    const { rows } = await harness.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM users",
    );
    expect(rows[0]!.n).toBe("1");
  });
});

describe("factories", () => {
  it("createTestUser produces a usable tenant scope", async () => {
    // The scope is pre-built so no test has to construct one. A test that had to call
    // tenantScope() itself is a test that could pass the wrong id.
    const user = await createTestUser(harness.pool);
    expect(user.scope).toBe(user.id);
    expect(user.email).toMatch(/@example\.test$/);
  });

  it("createTestUser makes a unique email every time", async () => {
    // A shared email would hit the ADR-031 partial unique index and fail the second
    // call, in a way that reads as a schema bug rather than a factory bug.
    const a = await createTestUser(harness.pool);
    const b = await createTestUser(harness.pool);
    expect(a.email).not.toBe(b.email);
  });

  it("createTestInvitation accepts a user or a bare id", async () => {
    const user = await createTestUser(harness.pool);
    const byObject = await createTestInvitation(harness.pool, { owner: user });
    const byId = await createTestInvitation(harness.pool, { owner: user.id });

    expect(byObject.ownerId).toBe(user.id);
    expect(byId.ownerId).toBe(user.id);
  });

  it("createTestInvitation creates a template version when none is given", async () => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
    });
    expect(invitation.templateVersionId).toEqual(expect.any(String));
  });

  it("createTestTemplateVersion round-trips sections as JSONB", async () => {
    const { versionId } = await createTestTemplateVersion(harness.pool, {
      sections: [{ section_key: "gallery", component: "GalleryGrid" }],
    });
    const { rows } = await harness.pool.query<{ sections: unknown[] }>(
      "SELECT sections FROM template_versions WHERE id = $1",
      [versionId],
    );
    expect(rows[0]!.sections).toEqual([
      { section_key: "gallery", component: "GalleryGrid" },
    ]);
  });

  it("createTestOrder and createTestMedia attach to an invitation", async () => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
    });

    const order = await createTestOrder(harness.pool, { invitation, user });
    const media = await createTestMedia(harness.pool, {
      invitation,
      uploadedBy: user,
    });

    expect(order.id).toEqual(expect.any(String));
    expect(media.id).toEqual(expect.any(String));
  });
});

describe("createTwoTenants — the IDOR starting point (docs/SECURITY/05)", () => {
  it("produces two users, each with their own invitation", async () => {
    const { alice, mallory } = await createTwoTenants(harness.pool);

    expect(alice.user.id).not.toBe(mallory.user.id);
    expect(alice.invitation.id).not.toBe(mallory.invitation.id);
    expect(alice.invitation.ownerId).toBe(alice.user.id);
    expect(mallory.invitation.ownerId).toBe(mallory.user.id);
  });

  it("gives each tenant their own template version", async () => {
    // Sharing one would be cheaper and would hide a real class of bug: a query that
    // filtered by template rather than by owner would pass a shared-template test and
    // leak in production.
    const { alice, mallory } = await createTwoTenants(harness.pool);
    expect(alice.invitation.templateVersionId).not.toBe(
      mallory.invitation.templateVersionId,
    );
  });

  /**
   * THE demonstration the DoD asks for.
   *
   * Note how little there is. That is the deliverable — the setup is one line, so the
   * next twenty endpoints have no excuse.
   */
  it("Mallory cannot read Alices invitation", async () => {
    const { alice, mallory } = await createTwoTenants(harness.pool);

    expect(
      await repo.findOwned(alice.invitation.id, mallory.user.scope),
    ).toBeNull();
    expect(
      await repo.findOwned(alice.invitation.id, alice.user.scope),
    ).not.toBeNull();
  });

  it("Mallorys list contains only her own invitation", async () => {
    const { alice, mallory } = await createTwoTenants(harness.pool);

    const hers = await repo.findOwnedList(mallory.user.scope);
    expect(hers.map((r) => r.id)).toEqual([mallory.invitation.id]);
    expect(hers.map((r) => r.id)).not.toContain(alice.invitation.id);
  });

  it("Mallory cannot reach Alices child rows through her own invitation", async () => {
    // docs/SECURITY/05 § 7, in three lines. The bank account is genuinely Alices and
    // the parent id is genuinely Mallorys — only the two-condition query stops it.
    const { alice, mallory } = await createTwoTenants(harness.pool);
    const { rows } = await harness.pool.query<{ id: string }>(
      `INSERT INTO invitation_bank_accounts (invitation_id, type, provider_name, account_number, account_holder)
       VALUES ($1, 'bank', 'BCA', '1234567890', 'Alice') RETURNING id`,
      [alice.invitation.id],
    );

    expect(
      await repo.findOwnedChild(
        schema.invitationBankAccounts,
        rows[0]!.id,
        mallory.invitation.id,
        mallory.user.scope,
      ),
    ).toBeNull();
  });
});
