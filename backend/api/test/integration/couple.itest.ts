import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { CoupleService } from "../../src/modules/invitation/couple.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { invitationPeople } from "../../src/infra/db/schema/invitations";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import {
  createTestInvitation,
  createTestUser,
  type TestUser,
} from "../support/factories";
import { createTwoTenants, expectServiceIdorSafe } from "../support/idor";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-11 — the couple sub-resource.
 *
 * The endpoint's own `:id` is checked, so the caller demonstrably owns the invitation.
 * `photo_media_id` is where it can still go wrong: a reference field is a **second**
 * tenancy boundary (`docs/SECURITY/05` § 6), and a caller who owns the invitation in the
 * path can still name somebody else's photo — which would then render on their public
 * page.
 */

describe("couple sub-resource", () => {
  let harness: Harness;
  let service: CoupleService;
  let repository: InvitationRepository;

  beforeAll(async () => {
    harness = await startHarness();
    repository = new InvitationRepository(harness.db);
    service = new CoupleService(repository);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  /** An invitation with both people rows, as `P1-09` would have created it. */
  const withCouple = async (): Promise<{
    user: TestUser;
    invitationId: string;
  }> => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
    });

    await harness.db.insert(invitationPeople).values([
      { invitationId: invitation.id, role: "groom" },
      { invitationId: invitation.id, role: "bride" },
    ]);

    return { user, invitationId: invitation.id };
  };

  const addMedia = async (
    invitationId: string,
    uploadedBy: string,
    status = "ready",
  ): Promise<string> => {
    // Raw SQL rather than Drizzle: `size_bytes` is a bigint, which Drizzle types as a
    // string in this schema, and the column list here is short enough that the indirection
    // costs more than it saves.
    const { rows } = await harness.pool.query<{ id: string }>(
      `INSERT INTO media (invitation_id, uploaded_by, purpose, status, storage_path, mime_type, size_bytes)
       VALUES ($1, $2, 'gallery', $3, $4, 'image/jpeg', 1024) RETURNING id`,
      [
        invitationId,
        uploadedBy,
        status,
        `k/${Math.random().toString(36).slice(2)}`,
      ],
    );
    return rows[0]!.id;
  };

  const personRow = async (invitationId: string, role: string) => {
    const [row] = await harness.db
      .select()
      .from(invitationPeople)
      .where(
        and(
          eq(invitationPeople.invitationId, invitationId),
          eq(invitationPeople.role, role),
        ),
      );
    return row;
  };

  describe("updating (the DoD's first item)", () => {
    it("updates the existing row", async () => {
      const { user, invitationId } = await withCouple();

      const result = await service.update(user.scope, invitationId, "groom", {
        fullName: "Budi Santoso",
        nickname: "Budi",
      });

      expect(result.full_name).toBe("Budi Santoso");
      expect(result.nickname).toBe("Budi");
    });

    it("creates no duplicate person row", async () => {
      // THE reason `P1-09` creates both rows empty. An upsert here would race between two
      // tabs and could produce a second `groom`, which `toInvitationDetail` would resolve
      // by silently picking whichever came back first.
      const { user, invitationId } = await withCouple();

      await Promise.all([
        service.update(user.scope, invitationId, "groom", { nickname: "A" }),
        service.update(user.scope, invitationId, "groom", { nickname: "B" }),
        service.update(user.scope, invitationId, "groom", { nickname: "C" }),
      ]);

      const rows = await harness.db
        .select()
        .from(invitationPeople)
        .where(
          and(
            eq(invitationPeople.invitationId, invitationId),
            eq(invitationPeople.role, "groom"),
          ),
        );
      expect(rows).toHaveLength(1);
    });

    it("touches only the named half of the couple", async () => {
      const { user, invitationId } = await withCouple();

      await service.update(user.scope, invitationId, "groom", {
        nickname: "Budi",
      });

      expect((await personRow(invitationId, "bride"))!.nickname).toBe("");
    });

    it("is partial — an absent field is left alone", async () => {
      const { user, invitationId } = await withCouple();
      await service.update(user.scope, invitationId, "groom", {
        fullName: "Budi Santoso",
        nickname: "Budi",
      });

      await service.update(user.scope, invitationId, "groom", {
        instagram: "budi",
      });

      const row = await personRow(invitationId, "groom");
      expect(row!.fullName).toBe("Budi Santoso");
      expect(row!.instagram).toBe("budi");
    });

    it("an empty patch reads without writing", async () => {
      const { user, invitationId } = await withCouple();
      await service.update(user.scope, invitationId, "groom", {
        nickname: "Budi",
      });
      const before = await personRow(invitationId, "groom");

      const result = await service.update(
        user.scope,
        invitationId,
        "groom",
        {},
      );

      expect(result.nickname).toBe("Budi");
      expect((await personRow(invitationId, "groom"))!.updatedAt).toEqual(
        before!.updatedAt,
      );
    });

    it("null clears an optional field", async () => {
      const { user, invitationId } = await withCouple();
      await service.update(user.scope, invitationId, "groom", {
        fatherName: "Pak Santoso",
      });

      await service.update(user.scope, invitationId, "groom", {
        fatherName: null,
      });

      expect((await personRow(invitationId, "groom"))!.fatherName).toBeNull();
    });

    it("role cannot be changed through the body", async () => {
      // The input type has no `role`; this is the runtime form of that.
      const { user, invitationId } = await withCouple();

      await service.update(user.scope, invitationId, "groom", {
        nickname: "Budi",
        role: "bride",
      } as never);

      expect((await personRow(invitationId, "groom"))!.nickname).toBe("Budi");
      expect((await personRow(invitationId, "bride"))!.nickname).toBe("");
    });
  });

  describe("photo_media_id is a second tenancy boundary (the DoD's second item)", () => {
    it("accepts a photo belonging to this invitation", async () => {
      const { user, invitationId } = await withCouple();
      const photo = await addMedia(invitationId, user.id);

      const result = await service.update(user.scope, invitationId, "groom", {
        photoMediaId: photo,
      });
      expect(result.photo_media_id).toBe(photo);
    });

    it("rejects a photo from ANOTHER invitation", async () => {
      // docs/SECURITY/05 § 6. The caller owns the invitation in the path -- that says
      // nothing about the photo, and without this check somebody else's picture would
      // render on their public page.
      const { alice, mallory } = await createTwoTenants(harness.pool);
      await harness.db.insert(invitationPeople).values([
        { invitationId: mallory.invitation.id, role: "groom" },
        { invitationId: mallory.invitation.id, role: "bride" },
      ]);

      const alicesPhoto = await addMedia(alice.invitation.id, alice.user.id);

      const error = await rejection(() =>
        service.update(mallory.user.scope, mallory.invitation.id, "groom", {
          photoMediaId: alicesPhoto,
        }),
      );

      expect(error.status).toBe(400);
      expect(JSON.stringify(error)).toContain("photo_media_id");
      expect(
        (await personRow(mallory.invitation.id, "groom"))!.photoMediaId,
      ).toBeNull();
    });

    it("rejects a photo from another invitation of the SAME user", async () => {
      // Narrower than "same owner", and correct: a photo belonging to a different
      // invitation is the wrong photo even when nobody else is involved.
      const user = await createTestUser(harness.pool);
      const a = await createTestInvitation(harness.pool, { owner: user });
      const b = await createTestInvitation(harness.pool, { owner: user });
      await harness.db
        .insert(invitationPeople)
        .values([{ invitationId: a.id, role: "groom" }]);

      const othersPhoto = await addMedia(b.id, user.id);

      await expect(
        service.update(user.scope, a.id, "groom", {
          photoMediaId: othersPhoto,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it.each(["processing", "failed"])(
      "rejects a photo whose status is %s",
      async (status) => {
        // The two non-ready statuses `media_status_check` permits. There is no
        // `quarantined` -- writing one here failed on the CHECK constraint, which is the
        // schema doing its job: `docs/SECURITY/06`'s malware stage marks a file `failed`.
        // A file still in the pipeline has not been through docs/SECURITY/06's
        // magic-byte, EXIF and malware stages. Referencing one would put an unvalidated
        // file on a public page the moment it finished processing.
        const { user, invitationId } = await withCouple();
        const photo = await addMedia(invitationId, user.id, status);

        await expect(
          service.update(user.scope, invitationId, "groom", {
            photoMediaId: photo,
          }),
        ).rejects.toMatchObject({ status: 400 });
      },
    );

    it("rejects a media id that does not exist", async () => {
      const { user, invitationId } = await withCouple();

      await expect(
        service.update(user.scope, invitationId, "groom", {
          photoMediaId: "00000000-0000-4000-8000-0000000000ff",
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("gives the same message for every rejection reason", async () => {
      // Telling them apart would let a caller probe which media ids exist, which is the
      // enumeration the 404 rule closes everywhere else.
      const { alice, mallory } = await createTwoTenants(harness.pool);
      await harness.db
        .insert(invitationPeople)
        .values([{ invitationId: mallory.invitation.id, role: "groom" }]);

      const alicesPhoto = await addMedia(alice.invitation.id, alice.user.id);

      const crossTenant = await rejection(() =>
        service.update(mallory.user.scope, mallory.invitation.id, "groom", {
          photoMediaId: alicesPhoto,
        }),
      );
      const missing = await rejection(() =>
        service.update(mallory.user.scope, mallory.invitation.id, "groom", {
          photoMediaId: "00000000-0000-4000-8000-0000000000ff",
        }),
      );

      expect(crossTenant.message).toBe(missing.message);
      expect(JSON.stringify(crossTenant)).toBe(JSON.stringify(missing));
    });

    it("null is allowed and clears the photo", async () => {
      const { user, invitationId } = await withCouple();
      const photo = await addMedia(invitationId, user.id);
      await service.update(user.scope, invitationId, "groom", {
        photoMediaId: photo,
      });

      const result = await service.update(user.scope, invitationId, "groom", {
        photoMediaId: null,
      });
      expect(result.photo_media_id).toBeNull();
    });
  });

  describe("IDOR (the DoD's fourth item)", () => {
    it.each(["groom", "bride"] as const)(
      "another user cannot update the %s",
      async (role) => {
        const { alice, mallory } = await createTwoTenants(harness.pool);
        await harness.db.insert(invitationPeople).values([
          { invitationId: alice.invitation.id, role: "groom" },
          { invitationId: alice.invitation.id, role: "bride" },
        ]);

        await expectServiceIdorSafe(() =>
          service.update(mallory.user.scope, alice.invitation.id, role, {
            nickname: "Hijacked",
          }),
        );

        expect((await personRow(alice.invitation.id, role))!.nickname).toBe("");
      },
    );

    it("a soft-deleted invitation cannot be updated", async () => {
      const { user, invitationId } = await withCouple();
      await harness.pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [invitationId],
      );

      await expect(
        service.update(user.scope, invitationId, "groom", { nickname: "X" }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("an invitation that does not exist is 404", async () => {
      const user = await createTestUser(harness.pool);

      await expect(
        service.update(
          user.scope,
          "00000000-0000-4000-8000-0000000000ff",
          "groom",
          { nickname: "X" },
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
