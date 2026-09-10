import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import { connect, tag, resetTenantData } from "./helpers.ts";
import * as schema from "../../src/infra/db/schema/index";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import {
  tenantScope,
  adminBypass,
  InvalidTenantScopeError,
  MissingBypassReasonError,
  type TenantScope,
} from "../../src/shared/tenancy/tenant-scope";

/**
 * P0-11 — tenant isolation, tested with TWO users in the database.
 *
 * That detail is the entire point. A fixture with one user proves nothing about
 * isolation: every query returns that user's rows whether or not the filter exists.
 * Every test here seeds Alice and Mallory and then asks whether Mallory can reach
 * Alice's data — the shape `docs/SECURITY/05` calls "the scenario that MUST be tested
 * for EVERY new :id endpoint".
 *
 * `docs/SECURITY/05` sets zero tolerance for regressions in this area. If any test in
 * this file fails, that is a release blocker and not a flake.
 */

let pool: Pool;
let repo: InvitationRepository;

interface Party {
  userId: string;
  scope: TenantScope;
  invitationId: string;
  templateId: string;
  versionId: string;
}

async function seedParty(name: string): Promise<Party> {
  const { rows: u } = await pool.query<{ id: string }>(
    "INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id",
    [`${name}-${tag()}@example.test`, name],
  );
  const userId = u[0]!.id;

  const { rows: t } = await pool.query<{ id: string }>(
    "INSERT INTO templates (slug, name) VALUES ($1, 'T') RETURNING id",
    [`tpl-${tag()}`],
  );
  const { rows: v } = await pool.query<{ id: string }>(
    "INSERT INTO template_versions (template_id, version, sections, theme) VALUES ($1, '1.0.0', '[]'::jsonb, '{}'::jsonb) RETURNING id",
    [t[0]!.id],
  );
  const { rows: i } = await pool.query<{ id: string }>(
    "INSERT INTO invitations (owner_id, template_id, template_version_id, internal_name) VALUES ($1, $2, $3, $4) RETURNING id",
    [userId, t[0]!.id, v[0]!.id, `${name}'s wedding`],
  );

  return {
    userId,
    scope: tenantScope(userId),
    invitationId: i[0]!.id,
    templateId: t[0]!.id,
    versionId: v[0]!.id,
  };
}

async function addBankAccount(invitationId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO invitation_bank_accounts (invitation_id, type, provider_name, account_number, account_holder)
     VALUES ($1, 'bank', 'BCA', '1234567890', 'Holder') RETURNING id`,
    [invitationId],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  pool = await connect([
    "invitations",
    "invitation_bank_accounts",
    "audit_logs",
  ]);
  repo = new InvitationRepository(drizzle(pool, { schema }));
});

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await resetTenantData(pool);
});

describe("tenantScope", () => {
  it("rejects anything that is not a user id", () => {
    // The brand exists so a slug, an invitation id or an empty string cannot be passed
    // where an owner filter belongs. These are the runtime half of that guarantee.
    for (const bad of ["", "not-a-uuid", "  ", "12345"]) {
      expect(() => tenantScope(bad)).toThrow(InvalidTenantScopeError);
    }
  });

  it("accepts a real user id", async () => {
    const alice = await seedParty("alice");
    expect(tenantScope(alice.userId)).toBe(alice.userId);
  });
});

describe("findOwned — IDOR on a parent resource (SECURITY/05 § 1)", () => {
  it("returns the invitation for its owner", async () => {
    const alice = await seedParty("alice");
    const found = await repo.findOwned(alice.invitationId, alice.scope);
    expect(found?.id).toBe(alice.invitationId);
  });

  it("returns null when the invitation belongs to someone else", async () => {
    // The core case. Mallory holds a real, valid invitation id -- she just does not
    // own it. The repository must not distinguish this from "does not exist", so the
    // service above cannot return a 403 that confirms the resource is real (ADR-018).
    const alice = await seedParty("alice");
    const mallory = await seedParty("mallory");

    const stolen = await repo.findOwned(alice.invitationId, mallory.scope);
    expect(stolen).toBeNull();
  });

  it("returns null for an id that does not exist at all", async () => {
    // Same answer as the case above, which is the property that matters: the two are
    // indistinguishable from outside.
    const alice = await seedParty("alice");
    const missing = await repo.findOwned(
      "00000000-0000-4000-8000-000000000000",
      alice.scope,
    );
    expect(missing).toBeNull();
  });

  it("returns null for a soft-deleted invitation", async () => {
    // ADR-033 lets a deleted invitation's slug be taken by a live one. Returning the
    // deleted row would let it shadow whatever replaced it.
    const alice = await seedParty("alice");
    await pool.query(
      "UPDATE invitations SET deleted_at = now() WHERE id = $1",
      [alice.invitationId],
    );

    expect(await repo.findOwned(alice.invitationId, alice.scope)).toBeNull();
  });

  it("ownsInvitation agrees with findOwned in both directions", async () => {
    const alice = await seedParty("alice");
    const mallory = await seedParty("mallory");

    expect(await repo.ownsInvitation(alice.invitationId, alice.scope)).toBe(
      true,
    );
    expect(await repo.ownsInvitation(alice.invitationId, mallory.scope)).toBe(
      false,
    );
  });
});

describe("findOwnedList — insecure API filtering (SECURITY/05 § 5)", () => {
  it("returns only the caller's invitations when the database holds two users' data", async () => {
    // docs/SECURITY/05 § 5 names response-level filtering as an attack surface by name.
    // With two users seeded, a missing WHERE clause shows up here as extra rows.
    const alice = await seedParty("alice");
    const mallory = await seedParty("mallory");

    const hers = await repo.findOwnedList(alice.scope);
    const his = await repo.findOwnedList(mallory.scope);

    expect(hers.map((r) => r.id)).toEqual([alice.invitationId]);
    expect(his.map((r) => r.id)).toEqual([mallory.invitationId]);
  });

  it("excludes soft-deleted invitations", async () => {
    const alice = await seedParty("alice");
    await pool.query(
      "UPDATE invitations SET deleted_at = now() WHERE id = $1",
      [alice.invitationId],
    );
    expect(await repo.findOwnedList(alice.scope)).toEqual([]);
  });

  it("filters by status without dropping the owner filter", async () => {
    const alice = await seedParty("alice");
    const mallory = await seedParty("mallory");
    await pool.query("UPDATE invitations SET status = 'published'");

    const hers = await repo.findOwnedList(alice.scope, { status: "published" });
    expect(hers.map((r) => r.id)).toEqual([alice.invitationId]);
    expect(hers).toHaveLength(1);
  });

  it("returns nothing for an empty status list rather than everything", async () => {
    // The classic way a filter silently becomes "no filter": an empty IN () list.
    const alice = await seedParty("alice");
    expect(await repo.findOwnedList(alice.scope, { status: [] })).toEqual([]);
  });

  it("caps the page size so a caller cannot ask for the whole table", async () => {
    const alice = await seedParty("alice");
    const rows = await repo.findOwnedList(alice.scope, { limit: 10_000 });
    expect(rows.length).toBeLessThanOrEqual(100);
  });
});

describe("findOwnedChild — cross-tenant sub-resources (SECURITY/05 § 6 and § 7)", () => {
  it("returns a child of the caller's own invitation", async () => {
    const alice = await seedParty("alice");
    const bankId = await addBankAccount(alice.invitationId);

    const found = await repo.findOwnedChild(
      schema.invitationBankAccounts,
      bankId,
      alice.invitationId,
      alice.scope,
    );
    expect(found?.id).toBe(bankId);
  });

  it("returns null for a child that belongs to another invitation", async () => {
    // THE attack from docs/SECURITY/05 § 7:
    //   PATCH /invitations/{mine}/bank-accounts/{someone-elses}
    // The parent is genuinely Mallory's, the child id is genuinely valid, and an
    // implementation that checks the parent then loads the child by id alone hands
    // over -- or overwrites -- Alice's bank account.
    const alice = await seedParty("alice");
    const mallory = await seedParty("mallory");
    const aliceBank = await addBankAccount(alice.invitationId);

    const stolen = await repo.findOwnedChild(
      schema.invitationBankAccounts,
      aliceBank,
      mallory.invitationId,
      mallory.scope,
    );
    expect(stolen).toBeNull();
  });

  it("returns null when the parent is not owned, even with a matching child", async () => {
    // The other direction: Mallory passes Alice's parent AND Alice's child, so both
    // ids are internally consistent. Only the owner check stops this.
    const alice = await seedParty("alice");
    const mallory = await seedParty("mallory");
    const aliceBank = await addBankAccount(alice.invitationId);

    const stolen = await repo.findOwnedChild(
      schema.invitationBankAccounts,
      aliceBank,
      alice.invitationId,
      mallory.scope,
    );
    expect(stolen).toBeNull();
  });

  it("refuses a child whose parent id does not match, within one owner", async () => {
    // Not an attack across tenants -- a correctness check that both conditions really
    // are applied. Alice owns two invitations; a child of the first must not be
    // reachable through the second.
    const alice = await seedParty("alice");
    const { rows: i2 } = await pool.query<{ id: string }>(
      "INSERT INTO invitations (owner_id, template_id, template_version_id) VALUES ($1, $2, $3) RETURNING id",
      [alice.userId, alice.templateId, alice.versionId],
    );
    const bankOnFirst = await addBankAccount(alice.invitationId);

    const found = await repo.findOwnedChild(
      schema.invitationBankAccounts,
      bankOnFirst,
      i2[0]!.id,
      alice.scope,
    );
    expect(found).toBeNull();
  });

  it("findOwnedChildren returns only that invitation's children", async () => {
    const alice = await seedParty("alice");
    const mallory = await seedParty("mallory");
    await addBankAccount(alice.invitationId);
    await addBankAccount(alice.invitationId);
    await addBankAccount(mallory.invitationId);

    const hers = await repo.findOwnedChildren(
      schema.invitationBankAccounts,
      alice.invitationId,
      alice.scope,
    );
    const stolen = await repo.findOwnedChildren(
      schema.invitationBankAccounts,
      alice.invitationId,
      mallory.scope,
    );

    expect(hers).toHaveLength(2);
    expect(stolen).toEqual([]);
  });
});

describe("admin bypass — SECURITY/05 § Special Case", () => {
  async function anAdmin(): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (email, full_name, role) VALUES ($1, 'Support', 'admin') RETURNING id",
      [`support-${tag()}@example.test`],
    );
    return rows[0]!.id;
  }

  it("returns another user's invitation, and writes an audit row", async () => {
    const alice = await seedParty("alice");
    const adminId = await anAdmin();

    const row = await repo.adminFindInvitationBypassingOwnership(
      alice.invitationId,
      adminBypass(
        adminId,
        "support ticket #4821: user reports invitation missing",
      ),
    );

    expect(row?.id).toBe(alice.invitationId);

    const { rows: audit } = await pool.query<{
      admin_id: string;
      action: string;
      resource_id: string;
      reason: string;
    }>("SELECT admin_id, action, resource_id, reason FROM audit_logs");

    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual({
      admin_id: adminId,
      action: "invitation.admin_read",
      resource_id: alice.invitationId,
      reason: "support ticket #4821: user reports invitation missing",
    });
  });

  it("writes an audit row even when the invitation does not exist", async () => {
    // An admin probing ids that do not exist is itself worth seeing in the trail.
    const adminId = await anAdmin();
    const row = await repo.adminFindInvitationBypassingOwnership(
      "00000000-0000-4000-8000-000000000000",
      adminBypass(adminId, "checking a reported id"),
    );

    expect(row).toBeNull();
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_logs",
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("cannot be called without a reason", () => {
    // The reason is what an incident reviewer reads months later to decide whether a
    // bypass was legitimate. Asking at the call site is the only moment anyone knows.
    expect(() =>
      adminBypass("00000000-0000-4000-8000-000000000000", ""),
    ).toThrow(MissingBypassReasonError);
    expect(() =>
      adminBypass("00000000-0000-4000-8000-000000000000", "   "),
    ).toThrow(MissingBypassReasonError);
  });

  it("fails closed when the audit row cannot be written", async () => {
    // docs/SECURITY/00 requires failing closed on anything security-relevant, and an
    // unauditable tenant-isolation bypass qualifies. Simulated with an admin id that
    // violates the audit_logs foreign key, so the insert fails inside the transaction.
    const alice = await seedParty("alice");
    const ghostAdmin = "00000000-0000-4000-8000-0000000000ff";

    await expect(
      repo.adminFindInvitationBypassingOwnership(
        alice.invitationId,
        adminBypass(ghostAdmin, "should not succeed"),
      ),
    ).rejects.toThrow();

    // And nothing was written: the read and the audit row roll back together.
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_logs",
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("the ordinary path writes no audit row", async () => {
    // Guards the opposite mistake: auditing every read would bury the bypasses in
    // noise, which is the same as not auditing them.
    const alice = await seedParty("alice");
    await repo.findOwned(alice.invitationId, alice.scope);

    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_logs",
    );
    expect(rows[0]!.n).toBe("0");
  });
});
