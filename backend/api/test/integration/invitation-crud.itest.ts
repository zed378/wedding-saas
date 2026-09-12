import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { InvitationService } from "../../src/modules/invitation/invitation.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { InvitationStatusService } from "../../src/shared/invitation-status/invitation-status.service";
import { invitations } from "../../src/infra/db/schema/invitations";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import {
  createTestInvitation,
  createTestUser,
  type TestUser,
} from "../support/factories";
import {
  createTwoTenants,
  expectIdorSafe,
  expectServiceIdorSafe,
} from "../support/idor";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-10 — list, detail, update and soft delete.
 *
 * The first task to use `expectIdorSafe` for real. `P1-06` built it and proved it can
 * fail; this is where that matters, because every one of these four endpoints takes an
 * `:id` from the URL and `docs/SECURITY/05` § 1 is the project's number one security
 * concern with zero tolerance for regressions.
 */

describe("invitation CRUD", () => {
  let harness: Harness;
  let service: InvitationService;
  let repository: InvitationRepository;

  beforeAll(async () => {
    harness = await startHarness();
    repository = new InvitationRepository(harness.db);
    service = new InvitationService(
      repository,
      new InvitationStatusService(harness.db),
    );
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  const withInvitation = async (): Promise<{
    user: TestUser;
    invitationId: string;
  }> => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
      internalName: "Budi & Ani",
    });
    return { user, invitationId: invitation.id };
  };

  describe("IDOR — all four endpoints (the DoD's second item)", () => {
    it("detail: another user gets 404 and no data", async () => {
      // The helper hands (invitationId, scope) in that order and the service takes them
      // the other way round -- exactly the mix-up the POSITIVE half of the helper catches,
      // since it also asserts the owner can still reach their own invitation.
      await expectIdorSafe(
        harness.pool,
        (id, scope) => service.detail(scope, id),
        { mustNotContain: ["Alice's wedding"] },
      );
    });

    it("update: another user gets 404", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await expectServiceIdorSafe(
        () =>
          service.update(mallory.user.scope, alice.invitation.id, {
            internalName: "Hijacked",
          }),
        { mustNotContain: ["Alice's wedding"] },
      );

      // ...and nothing changed.
      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, alice.invitation.id));
      expect(row!.internalName).toBe("Alice's wedding");
    });

    it("delete: another user gets 404 and the row survives", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await expectServiceIdorSafe(() =>
        service.softDelete(mallory.user.scope, alice.invitation.id),
      );

      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, alice.invitation.id));
      expect(row!.deletedAt).toBeNull();
    });

    it("list: a second user's invitations never appear", async () => {
      // docs/SECURITY/05 § 5 names response-level filtering as the wrong implementation.
      // This is the test that would catch it.
      const { alice, mallory } = await createTwoTenants(harness.pool);

      const mine = await service.list(mallory.user.scope, {
        limit: 50,
        offset: 0,
      });

      expect(mine.items).toHaveLength(1);
      expect(mine.items[0]!.id).toBe(mallory.invitation.id);
      expect(JSON.stringify(mine)).not.toContain(alice.invitation.id);
      expect(JSON.stringify(mine)).not.toContain("Alice's wedding");
    });

    it("the list total counts only mine", async () => {
      // A total computed without the owner filter would leak the platform's size, and
      // would also make pagination lie.
      const { mallory } = await createTwoTenants(harness.pool);

      expect(
        (await service.list(mallory.user.scope, { limit: 50, offset: 0 }))
          .total,
      ).toBe(1);
    });
  });

  describe("list", () => {
    it("is empty for a new account", async () => {
      const user = await createTestUser(harness.pool);
      expect(await service.list(user.scope, { limit: 50, offset: 0 })).toEqual({
        items: [],
        total: 0,
      });
    });

    it("paginates, and the total is the whole set", async () => {
      const user = await createTestUser(harness.pool);
      for (let i = 0; i < 5; i += 1) {
        await createTestInvitation(harness.pool, {
          owner: user,
          internalName: `Invitation ${i}`,
        });
      }

      const page = await service.list(user.scope, { limit: 2, offset: 0 });
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(5);

      const last = await service.list(user.scope, { limit: 2, offset: 4 });
      expect(last.items).toHaveLength(1);
      expect(last.total).toBe(5);
    });

    it("filters by status in SQL", async () => {
      const user = await createTestUser(harness.pool);
      await createTestInvitation(harness.pool, { owner: user });
      const published = await createTestInvitation(harness.pool, {
        owner: user,
        status: "published",
      });

      const result = await service.list(user.scope, {
        limit: 50,
        offset: 0,
        status: "published",
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe(published.id);
      expect(result.total).toBe(1);
    });

    it("omits soft-deleted invitations", async () => {
      const { user, invitationId } = await withInvitation();
      await service.softDelete(user.scope, invitationId);

      expect(await service.list(user.scope, { limit: 50, offset: 0 })).toEqual({
        items: [],
        total: 0,
      });
    });

    it("returns the summary shape, not the row", async () => {
      // docs/SECURITY/08 § Mass Data Exposure. An explicit projection means a new column
      // is not served until somebody decides to serve it.
      const { user } = await withInvitation();
      const [item] = (await service.list(user.scope, { limit: 50, offset: 0 }))
        .items;

      expect(Object.keys(item!).sort()).toEqual([
        "created_at",
        "expiry_date",
        "id",
        "internal_name",
        "published_at",
        "slug",
        "status",
        "template_id",
        "template_version_id",
        "updated_at",
      ]);
    });
  });

  describe("detail", () => {
    it("matches docs/API/04's shape", async () => {
      const { user, invitationId } = await withInvitation();
      const detail = await service.detail(user.scope, invitationId);

      expect(Object.keys(detail).sort()).toEqual([
        "bank_accounts",
        "couple",
        "created_at",
        "events",
        "expiry_date",
        "gallery",
        "id",
        "internal_name",
        "owner_id",
        "published_at",
        "quote",
        "settings",
        "slug",
        "status",
        "template_id",
        "template_version_id",
        "updated_at",
      ]);
    });

    it("embeds the nested entities", async () => {
      const { user, invitationId } = await withInvitation();
      const detail = await service.detail(user.scope, invitationId);

      expect(detail.couple).toHaveProperty("groom");
      expect(detail.couple).toHaveProperty("bride");
      expect(Array.isArray(detail.events)).toBe(true);
      expect(Array.isArray(detail.gallery)).toBe(true);
      expect(Array.isArray(detail.bank_accounts)).toBe(true);
      expect(detail.quote).toEqual({ text: null, source: null });
      expect(detail.settings).toHaveProperty("enabled_sections");
    });

    it("a soft-deleted invitation is 404 to its own owner", async () => {
      const { user, invitationId } = await withInvitation();
      await service.softDelete(user.scope, invitationId);

      await expect(
        service.detail(user.scope, invitationId),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("an invitation that never existed is 404", async () => {
      const user = await createTestUser(harness.pool);

      await expect(
        service.detail(user.scope, "00000000-0000-4000-8000-0000000000ff"),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("update", () => {
    it("changes internal_name", async () => {
      const { user, invitationId } = await withInvitation();

      const updated = await service.update(user.scope, invitationId, {
        internalName: "Budi & Ani — revisi",
      });
      expect(updated.internal_name).toBe("Budi & Ani — revisi");
    });

    it("returns the full detail, so a client needs no second request", async () => {
      const { user, invitationId } = await withInvitation();
      const updated = await service.update(user.scope, invitationId, {
        internalName: "X",
      });

      expect(updated).toHaveProperty("couple");
      expect(updated).toHaveProperty("settings");
    });

    it("status cannot be changed through it (the DoD's third item)", async () => {
      // The input type has no `status`, so this is a compile error made runnable by a
      // cast -- which is what a client's JSON amounts to.
      const { user, invitationId } = await withInvitation();

      await service.update(user.scope, invitationId, {
        internalName: "Still a draft",
        status: "published",
      } as never);

      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId));
      expect(row!.status).toBe("draft");
      expect(row!.publishedAt).toBeNull();
    });

    it.each([
      ["ownerId", "22222222-2222-4222-8222-222222222222"],
      ["templateVersionId", "22222222-2222-4222-8222-222222222222"],
      ["slug", "hijacked-slug"],
      ["expiryDate", "2030-01-01"],
    ])("%s cannot be changed through it", async (field, value) => {
      const { user, invitationId } = await withInvitation();
      const [before] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId));

      await service.update(user.scope, invitationId, {
        internalName: "A new name",
        [field]: value,
      } as never);

      const [after] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId));

      expect(after!.ownerId).toBe(before!.ownerId);
      expect(after!.templateVersionId).toBe(before!.templateVersionId);
      expect(after!.slug).toBe(before!.slug);
      expect(after!.expiryDate).toBe(before!.expiryDate);
      // ...and the legitimate field went through, so this is not passing by doing nothing.
      expect(after!.internalName).toBe("A new name");
    });

    it("a soft-deleted invitation cannot be updated", async () => {
      const { user, invitationId } = await withInvitation();
      await service.softDelete(user.scope, invitationId);

      await expect(
        service.update(user.scope, invitationId, { internalName: "X" }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("soft delete (the DoD's fifth item)", () => {
    it("the row survives with deleted_at set", async () => {
      const { user, invitationId } = await withInvitation();
      await service.softDelete(user.scope, invitationId);

      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId));

      expect(row).toBeDefined();
      expect(row!.deletedAt).not.toBeNull();
      expect(row!.internalName).toBe("Budi & Ani");
    });

    it("records the status transition", async () => {
      // Through P0-14's service, so the journey stays reconstructable.
      const { user, invitationId } = await withInvitation();
      await service.softDelete(user.scope, invitationId);

      const { rows } = await harness.pool.query<{
        to_status: string;
        from_status: string | null;
      }>(
        "SELECT from_status, to_status FROM invitation_status_history WHERE invitation_id = $1 ORDER BY created_at DESC LIMIT 1",
        [invitationId],
      );
      expect(rows[0]!.to_status).toBe("soft_deleted");
    });

    it("frees the slug (docs/DATABASE/04 § Notes)", async () => {
      // The partial unique index from ADR-033 covers live rows only.
      const first = await createTestUser(harness.pool);
      const invitation = await createTestInvitation(harness.pool, {
        owner: first,
        slug: "budi-dan-ani",
      });

      await service.softDelete(first.scope, invitation.id);

      const second = await createTestUser(harness.pool);
      await expect(
        createTestInvitation(harness.pool, {
          owner: second,
          slug: "budi-dan-ani",
        }),
      ).resolves.toBeDefined();
    });

    it("is idempotent-ish: a second delete is 404", async () => {
      const { user, invitationId } = await withInvitation();
      await service.softDelete(user.scope, invitationId);

      await expect(
        service.softDelete(user.scope, invitationId),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("leaves other invitations alone", async () => {
      const user = await createTestUser(harness.pool);
      const a = await createTestInvitation(harness.pool, { owner: user });
      const b = await createTestInvitation(harness.pool, { owner: user });

      await service.softDelete(user.scope, a.id);

      const remaining = await service.list(user.scope, {
        limit: 50,
        offset: 0,
      });
      expect(remaining.items.map((i) => i.id)).toEqual([b.id]);
    });
  });

  describe("no SELECT * reaches a response (docs/SECURITY/08)", () => {
    it("the detail projection has no unexpected keys", async () => {
      // A new column on `invitations` must not start being served because nobody
      // remembered to exclude it.
      const { user, invitationId } = await withInvitation();
      const detail = await service.detail(user.scope, invitationId);

      const serialised = JSON.stringify(detail);
      expect(serialised).not.toContain("deletedAt");
      expect(serialised).not.toContain("deleted_at");
    });

    it("the error from a missing invitation carries nothing", async () => {
      const user = await createTestUser(harness.pool);
      const error = await rejection(() =>
        service.detail(user.scope, "00000000-0000-4000-8000-0000000000ff"),
      );

      expect(JSON.stringify(error)).not.toContain("invitations");
      expect(error.status).toBe(404);
    });
  });
});
