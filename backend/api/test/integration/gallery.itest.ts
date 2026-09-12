import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GalleryService } from "../../src/modules/invitation/gallery.service";
import { MAX_PHOTOS_PER_INVITATION } from "../../src/modules/media/media.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import type { Env } from "../../src/config/env.schema";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import {
  createTestInvitation,
  createTestUser,
  type TestUser,
} from "../support/factories";
import { expectServiceIdorSafe } from "../support/idor";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-19 — the gallery. `docs/API/04` § Gallery, BR-8.1.
 *
 * Three claims carry the card, and each of them is a statement about what happens when
 * something goes wrong rather than when it goes right:
 *
 *   attaching another invitation's photo is a 404, not a 422 and not a success;
 *   **exactly one** cover exists, which means every path that sets one clears the others;
 *   a reorder with a wrong id changes **nothing**, not most things.
 */

const env = { CDN_BASE_URL: "https://cdn.test" } as Env;

describe("the gallery", () => {
  let harness: Harness;
  let service: GalleryService;
  let repository: InvitationRepository;

  beforeAll(async () => {
    harness = await startHarness();
    repository = new InvitationRepository(harness.db);
    service = new GalleryService(repository, env);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  const owned = async (): Promise<{
    user: TestUser;
    invitationId: string;
  }> => {
    const user = await createTestUser(harness.pool);
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
    });
    return { user, invitationId: invitation.id };
  };

  /** A media row belonging to an invitation, in whatever state the test needs. */
  const mediaFor = async (
    invitationId: string | null,
    status = "ready",
  ): Promise<string> => {
    const { rows } = await harness.pool.query<{ id: string }>(
      `INSERT INTO media (invitation_id, purpose, status, storage_path, width, height)
       VALUES ($1, 'gallery', $2, $3, 1600, 1200) RETURNING id`,
      [invitationId, status, `uploads/${Math.random().toString(36).slice(2)}`],
    );
    return rows[0]!.id;
  };

  const galleryRows = async (invitationId: string) => {
    const { rows } = await harness.pool.query<{
      id: string;
      media_id: string;
      caption: string | null;
      display_order: number;
      is_cover: boolean;
    }>(
      "SELECT * FROM invitation_gallery WHERE invitation_id = $1 ORDER BY display_order",
      [invitationId],
    );
    return rows;
  };

  // ------------------------------------------------------------------ attach

  describe("attaching a photo", () => {
    it("appends it and returns the rendered shape", async () => {
      const { user, invitationId } = await owned();
      const mediaId = await mediaFor(invitationId);

      const photo = await service.attach(user.scope, invitationId, {
        mediaId,
        caption: "Prewedding di pantai",
      });

      expect(photo).toMatchObject({
        media_id: mediaId,
        caption: "Prewedding di pantai",
        display_order: 0,
        is_cover: false,
        status: "ready",
        width: 1600,
      });
      expect(photo.url).toBe(
        `https://cdn.test/invitations/${invitationId}/media/${mediaId}/large.webp`,
      );
    });

    it("appends rather than prepending, so an order the couple chose is not disturbed", async () => {
      const { user, invitationId } = await owned();

      const first = await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
      });
      const second = await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
      });

      expect(first.display_order).toBe(0);
      expect(second.display_order).toBe(1);
    });

    it.each([
      ["processing", "processing"],
      ["failed", "failed"],
    ])("refuses a %s photo with a 404", async (_name, status) => {
      // A `processing` row has not been scanned, decoded or EXIF-stripped; a `failed` one
      // has no file. Attaching either puts an unscanned or absent image on a page hundreds
      // of guests open -- what `P1-18` exists to prevent, arriving through another door.
      const { user, invitationId } = await owned();
      const mediaId = await mediaFor(invitationId, status);

      const error = await rejection(() =>
        service.attach(user.scope, invitationId, { mediaId }),
      );

      expect(error).toMatchObject({ status: 404 });
      expect(await galleryRows(invitationId)).toHaveLength(0);
    });

    it("refuses a soft-deleted photo", async () => {
      const { user, invitationId } = await owned();
      const mediaId = await mediaFor(invitationId);
      await harness.pool.query(
        "UPDATE media SET deleted_at = now() WHERE id = $1",
        [mediaId],
      );

      const error = await rejection(() =>
        service.attach(user.scope, invitationId, { mediaId }),
      );
      expect(error).toMatchObject({ status: 404 });
    });

    it("refuses the same photo twice", async () => {
      // A second entry for one file means nothing to a viewer and would let 200 uploads
      // become 400 gallery slots.
      const { user, invitationId } = await owned();
      const mediaId = await mediaFor(invitationId);
      await service.attach(user.scope, invitationId, { mediaId });

      const error = await rejection(() =>
        service.attach(user.scope, invitationId, { mediaId }),
      );

      expect(error).toMatchObject({ code: "PHOTO_ALREADY_ATTACHED" });
      expect(await galleryRows(invitationId)).toHaveLength(1);
    });

    it("attaching another invitation's media returns 404", async () => {
      // The card's first DoD item, and `docs/SECURITY/05` § 6's named case. 404 rather than
      // 422: the media id came from a request body, so "belongs to someone else" and "does
      // not exist" must be indistinguishable.
      const alice = await owned();
      const mallory = await owned();
      const aliceMedia = await mediaFor(alice.invitationId);

      const error = await rejection(() =>
        service.attach(mallory.user.scope, mallory.invitationId, {
          mediaId: aliceMedia,
        }),
      );

      expect(error).toMatchObject({ status: 404 });
      expect(await galleryRows(mallory.invitationId)).toHaveLength(0);
    });

    it("refuses media belonging to ANOTHER invitation of the same user", async () => {
      // The distinction `P1-11` found on `photo_media_id`: owning the media is not the
      // question. A photo from the user's other wedding is still the wrong photo, and a
      // check written as "does this user own the media" would let it through.
      const { user, invitationId } = await owned();
      const otherInvitation = await createTestInvitation(harness.pool, {
        owner: user,
      });
      const otherMedia = await mediaFor(otherInvitation.id);

      const error = await rejection(() =>
        service.attach(user.scope, invitationId, { mediaId: otherMedia }),
      );

      expect(error).toMatchObject({ status: 404 });
    });

    it("refuses a template asset, which belongs to no invitation", async () => {
      const { user, invitationId } = await owned();
      const assetId = await mediaFor(null);

      const error = await rejection(() =>
        service.attach(user.scope, invitationId, { mediaId: assetId }),
      );
      expect(error).toMatchObject({ status: 404 });
    });
  });

  // ------------------------------------------------------------------- cover

  describe("the cover (card DoD 2)", () => {
    it("setting a new cover clears the previous one", async () => {
      const { user, invitationId } = await owned();
      const first = await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
        isCover: true,
      });

      const second = await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
        isCover: true,
      });

      const rows = await galleryRows(invitationId);
      expect(rows.filter((r) => r.is_cover)).toHaveLength(1);
      expect(rows.find((r) => r.is_cover)!.id).toBe(second.id);
      expect(rows.find((r) => r.id === first.id)!.is_cover).toBe(false);
    });

    it("promoting an existing photo clears the previous cover too", async () => {
      // Both paths that can set a cover must clear first, or "exactly one" holds on one of
      // them and not the other -- and the failure is invisible until two screens disagree.
      const { user, invitationId } = await owned();
      const first = await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
        isCover: true,
      });
      const second = await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
      });

      await service.update(user.scope, invitationId, second.id, {
        isCover: true,
      });

      const rows = await galleryRows(invitationId);
      expect(rows.filter((r) => r.is_cover).map((r) => r.id)).toEqual([
        second.id,
      ]);
      expect(rows.find((r) => r.id === first.id)!.is_cover).toBe(false);
    });

    it("a gallery can have no cover at all", async () => {
      // Nothing forces one. A template that has no cover section should not oblige the user
      // to nominate a photo that is never shown.
      const { user, invitationId } = await owned();
      await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
      });

      expect(
        (await galleryRows(invitationId)).filter((r) => r.is_cover),
      ).toEqual([]);
    });

    it("clearing the cover leaves none", async () => {
      const { user, invitationId } = await owned();
      const photo = await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
        isCover: true,
      });

      await service.update(user.scope, invitationId, photo.id, {
        isCover: false,
      });

      expect(
        (await galleryRows(invitationId)).filter((r) => r.is_cover),
      ).toEqual([]);
    });
  });

  // ----------------------------------------------------------------- reorder

  describe("reordering (card DoD 3)", () => {
    const threePhotos = async () => {
      const { user, invitationId } = await owned();
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const photo = await service.attach(user.scope, invitationId, {
          mediaId: await mediaFor(invitationId),
        });
        ids.push(photo.id);
      }
      return { user, invitationId, ids };
    };

    it("applies the requested order", async () => {
      const { user, invitationId, ids } = await threePhotos();

      const result = await service.reorder(user.scope, invitationId, [
        ids[2]!,
        ids[0]!,
        ids[1]!,
      ]);

      expect(result.map((p) => p.id)).toEqual([ids[2], ids[0], ids[1]]);
      expect((await galleryRows(invitationId)).map((r) => r.id)).toEqual([
        ids[2],
        ids[0],
        ids[1],
      ]);
    });

    it.each([
      [
        "a foreign id",
        // A constant that no factory produces. It used to be `ids[2].replace(/.$/, "0")`
        // -- the last character of a real uuid rewritten to "0" -- which is the SAME id
        // whenever that uuid already ended in "0". One run in sixteen the "foreign" list
        // was a valid complete permutation, the reorder correctly succeeded, and the test
        // failed. Found when it fired during an unrelated full-suite run.
        (ids: string[]) => [
          ids[0]!,
          ids[1]!,
          "00000000-0000-4000-8000-0000000000ff",
        ],
      ],
      ["a missing id", (ids: string[]) => [ids[0]!, ids[1]!]],
      ["a duplicate", (ids: string[]) => [ids[0]!, ids[0]!, ids[1]!]],
      ["an extra id", (ids: string[]) => [...ids, ids[0]!]],
    ])("rejects %s wholesale, applying nothing", async (_name, build) => {
      const { user, invitationId, ids } = await threePhotos();
      const before = await galleryRows(invitationId);

      const error = await rejection(() =>
        service.reorder(user.scope, invitationId, build(ids)),
      );

      expect(error).toMatchObject({ status: 400 });
      // The load-bearing half: nothing moved. A partial application leaves the user looking
      // at an arrangement nobody chose, with nothing to explain it.
      expect(await galleryRows(invitationId)).toEqual(before);
    });

    it("a photo id from another invitation cannot be reordered into mine", async () => {
      // Not only a validation rule. Without the "no foreign id" check, this list would be a
      // cross-tenant WRITE: another invitation's photo would have its display_order
      // rewritten by a request that looks like a preference.
      const alice = await threePhotos();
      const mallory = await threePhotos();
      const before = await galleryRows(alice.invitationId);

      await rejection(() =>
        service.reorder(mallory.user.scope, mallory.invitationId, [
          alice.ids[0]!,
          mallory.ids[0]!,
          mallory.ids[1]!,
        ]),
      );

      expect(await galleryRows(alice.invitationId)).toEqual(before);
    });
  });

  // ------------------------------------------------------------------ delete

  describe("removing a photo (step 6)", () => {
    it("deletes the placement and SOFT-deletes the media", async () => {
      // `docs/PLAN/11` § Deletion. The file survives a grace period so a mistake is
      // recoverable and so nothing vanishes from a CDN cache mid-serve.
      const { user, invitationId } = await owned();
      const mediaId = await mediaFor(invitationId);
      const photo = await service.attach(user.scope, invitationId, { mediaId });

      await service.remove(user.scope, invitationId, photo.id);

      expect(await galleryRows(invitationId)).toHaveLength(0);

      const { rows } = await harness.pool.query<{
        deleted_at: Date | null;
        status: string;
      }>("SELECT deleted_at, status FROM media WHERE id = $1", [mediaId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.deleted_at).not.toBeNull();
      // Not `failed`: the photo was fine. It is retired, not rejected.
      expect(rows[0]!.status).toBe("ready");
    });

    it("gives the quota slot back", async () => {
      const { user, invitationId } = await owned();
      const mediaId = await mediaFor(invitationId);
      const photo = await service.attach(user.scope, invitationId, { mediaId });

      await service.remove(user.scope, invitationId, photo.id);

      const { rows } = await harness.pool.query<{ total: string }>(
        "SELECT count(*) AS total FROM media WHERE invitation_id = $1 AND deleted_at IS NULL",
        [invitationId],
      );
      expect(Number(rows[0]!.total)).toBe(0);
    });

    it("a photo id belonging to another invitation is 404", async () => {
      const alice = await owned();
      const mallory = await owned();
      const photo = await service.attach(alice.user.scope, alice.invitationId, {
        mediaId: await mediaFor(alice.invitationId),
      });

      const error = await rejection(() =>
        // Mallory's own invitation in the path, Alice's photo id: `docs/SECURITY/05` § 7.
        service.remove(mallory.user.scope, mallory.invitationId, photo.id),
      );

      expect(error).toMatchObject({ status: 404 });
      expect(await galleryRows(alice.invitationId)).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------- quota

  describe("the quota (card DoD 4, BR-8.1)", () => {
    /** Fill the gallery to `count` entries without going through the service. */
    const fill = async (invitationId: string, count: number) => {
      for (let i = 0; i < count; i += 1) {
        const mediaId = await mediaFor(invitationId);
        await harness.pool.query(
          `INSERT INTO invitation_gallery (invitation_id, media_id, display_order)
           VALUES ($1, $2, $3)`,
          [invitationId, mediaId, i],
        );
      }
    };

    it("refuses the attach that would exceed it", async () => {
      const { user, invitationId } = await owned();
      await fill(invitationId, MAX_PHOTOS_PER_INVITATION);

      const mediaId = await mediaFor(invitationId);
      const error = await rejection(() =>
        service.attach(user.scope, invitationId, { mediaId }),
      );

      expect(error).toMatchObject({ code: "QUOTA_EXCEEDED" });
    });

    it("allows the last one under the limit", async () => {
      const { user, invitationId } = await owned();
      await fill(invitationId, MAX_PHOTOS_PER_INVITATION - 1);

      const photo = await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
      });
      expect(photo.display_order).toBe(MAX_PHOTOS_PER_INVITATION - 1);
    });

    it("the attach takes a conflicting row lock on the invitation", async () => {
      // The deterministic proof, written the way `P1-17`'s was after its race test turned
      // out to pass with the lock removed. The probe holds `FOR NO KEY UPDATE`, which
      // conflicts with `FOR UPDATE` and NOT with the `FOR KEY SHARE` the gallery insert's
      // foreign key takes on its own — so an attach that blocks here can only be blocking
      // on the quota lock.
      const { user, invitationId } = await owned();
      const mediaId = await mediaFor(invitationId);
      const probe = await harness.pool.connect();

      try {
        await probe.query("BEGIN");
        await probe.query(
          "SELECT id FROM invitations WHERE id = $1 FOR NO KEY UPDATE",
          [invitationId],
        );

        let settled = false;
        const attach = service
          .attach(user.scope, invitationId, { mediaId })
          .then((photo) => {
            settled = true;
            return photo;
          });

        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(settled).toBe(false);

        await probe.query("COMMIT");
        await expect(attach).resolves.toMatchObject({ media_id: mediaId });
      } finally {
        probe.release();
      }
    });

    it("concurrent attaches at the boundary leave the cap intact", async () => {
      const { user, invitationId } = await owned();
      await fill(invitationId, MAX_PHOTOS_PER_INVITATION - 1);
      const media = await Promise.all(
        Array.from({ length: 6 }, () => mediaFor(invitationId)),
      );

      const results = await Promise.allSettled(
        media.map((mediaId) =>
          service.attach(user.scope, invitationId, { mediaId }),
        ),
      );

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await galleryRows(invitationId)).toHaveLength(
        MAX_PHOTOS_PER_INVITATION,
      );
    });
  });

  // -------------------------------------------------------------------- IDOR

  describe("cross-tenant access (docs/SECURITY/05)", () => {
    it("a foreign scope cannot list my gallery", async () => {
      const alice = await owned();
      const mallory = await owned();
      await service.attach(alice.user.scope, alice.invitationId, {
        mediaId: await mediaFor(alice.invitationId),
      });

      await expectServiceIdorSafe(() =>
        service.list(mallory.user.scope, alice.invitationId),
      );
    });

    it("a foreign scope cannot attach to my gallery", async () => {
      const alice = await owned();
      const mallory = await owned();
      const mediaId = await mediaFor(alice.invitationId);

      await expectServiceIdorSafe(() =>
        service.attach(mallory.user.scope, alice.invitationId, { mediaId }),
      );

      expect(await galleryRows(alice.invitationId)).toHaveLength(0);
    });

    it("the repository refuses a foreign scope on every gallery write", async () => {
      // P1-12's rule: the service's check masks the repository's, so each write is
      // exercised directly. Removing an owner predicate must fail HERE.
      const alice = await owned();
      const mallory = await owned();
      const photo = await service.attach(alice.user.scope, alice.invitationId, {
        mediaId: await mediaFor(alice.invitationId),
      });

      expect(
        await repository.attachGalleryPhoto(
          alice.invitationId,
          mallory.user.scope,
          {
            mediaId: await mediaFor(alice.invitationId),
            maxPhotos: MAX_PHOTOS_PER_INVITATION,
          },
        ),
      ).toEqual({ kind: "not_found" });

      expect(
        await repository.updateGalleryPhoto(
          photo.id,
          alice.invitationId,
          mallory.user.scope,
          { isCover: true },
        ),
      ).toBeNull();

      expect(
        await repository.deleteGalleryPhoto(
          photo.id,
          alice.invitationId,
          mallory.user.scope,
        ),
      ).toBe(false);

      expect(
        await repository.reorderGallery(
          alice.invitationId,
          mallory.user.scope,
          [photo.id],
        ),
      ).toBe("not_found");

      expect(
        await repository.findOwnedGallery(
          alice.invitationId,
          mallory.user.scope,
        ),
      ).toEqual([]);

      // Untouched throughout.
      const rows = await galleryRows(alice.invitationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.is_cover).toBe(false);
    });

    it("a soft-deleted invitation refuses everything", async () => {
      const { user, invitationId } = await owned();
      const photo = await service.attach(user.scope, invitationId, {
        mediaId: await mediaFor(invitationId),
      });
      await harness.pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [invitationId],
      );

      await expectServiceIdorSafe(() => service.list(user.scope, invitationId));
      await expectServiceIdorSafe(() =>
        service.update(user.scope, invitationId, photo.id, { caption: "x" }),
      );
      await expectServiceIdorSafe(() =>
        service.remove(user.scope, invitationId, photo.id),
      );
    });
  });
});
