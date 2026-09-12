import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryStorage, parseStoredKey } from "@wi/storage";

import {
  MAX_PHOTOS_PER_INVITATION,
  MediaService,
  type UploadedFilePart,
} from "../../src/modules/media/media.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import type { Env } from "../../src/config/env.schema";
import type { JobQueue } from "../../src/infra/queue/queue.module";
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
 * P1-17 — the synchronous upload stage. `docs/SECURITY/06` layers 1-5, 8, 9.
 *
 * Two things this suite is careful about, because both are easy to assert wrongly:
 *
 * **"Nothing is stored" must mean the object store too.** A test that only checks the
 * database would pass while a refused upload left bytes in staging. `InMemoryStorage` is
 * inspected directly for that reason.
 *
 * **"The path contains no attacker-controlled string" must be asserted against a filename
 * that would be obvious if it leaked.** `../../../etc/passwd` in the stored key is visible;
 * `photo.jpg` in the stored key is not.
 */

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PHP_SHELL = Buffer.from('<?php system($_GET["c"]); ?>');

/** A plausible multipart part. Only the four fields the service reads. */
const part = (overrides: Partial<UploadedFilePart> = {}): UploadedFilePart => {
  const buffer = overrides.buffer ?? JPEG_HEADER;
  return {
    originalname: overrides.originalname ?? "prewedding.jpg",
    mimetype: overrides.mimetype ?? "image/jpeg",
    size: overrides.size ?? buffer.length,
    buffer,
  };
};

describe("media upload, synchronous stage", () => {
  let harness: Harness;
  let service: MediaService;
  let repository: InvitationRepository;
  let storage: InMemoryStorage;
  let enqueued: { pool: string; name: string; data: unknown }[];

  const queue: JobQueue = {
    enqueue: async (pool, name, data) => {
      enqueued.push({ pool, name, data });
    },
    close: async () => {},
  };

  const env = { CDN_BASE_URL: "https://cdn.test" } as Env;

  beforeAll(async () => {
    harness = await startHarness();
    repository = new InvitationRepository(harness.db);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    storage = new InMemoryStorage();
    enqueued = [];
    service = new MediaService(repository, storage, queue, env);
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

  /**
   * The staging keys, with `InMemoryStorage`'s bucket prefix stripped.
   *
   * The fake returns `staging::uploads/<id>` so one map can hold every bucket. Comparing
   * against the prefixed form in every test would make each assertion about the fake's
   * internals rather than about the path the product built.
   */
  const stagingKeys = (): string[] =>
    storage.keys("staging").map((k) => k.replace("staging::", ""));

  const mediaRows = async (invitationId: string) => {
    const { rows } = await harness.pool.query<{
      id: string;
      status: string;
      purpose: string;
      storage_path: string;
      mime_type: string;
      size_bytes: string;
      width: number | null;
      height: number | null;
      uploaded_by: string;
    }>("SELECT * FROM media WHERE invitation_id = $1", [invitationId]);
    return rows;
  };

  // ------------------------------------------------------------ the happy path

  describe("accepting a file", () => {
    it("creates one processing row and one staging object", async () => {
      const { user, invitationId } = await owned();

      const result = await service.upload(
        user.scope,
        invitationId,
        "gallery",
        part(),
      );

      expect(result).toEqual({
        id: result.id,
        status: "processing",
        purpose: "gallery",
      });

      const rows = await mediaRows(invitationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("processing");
      expect(rows[0]!.uploaded_by).toBe(user.id);
      // Not decoded. `docs/BACKEND/04` Stage 2 fills these in; a row claiming dimensions
      // before anything read the pixels would be a row nobody could trust.
      expect(rows[0]!.width).toBeNull();
      expect(rows[0]!.height).toBeNull();

      const stored = await storage.get(
        "staging",
        parseStoredKey(rows[0]!.storage_path),
      );
      expect(stored?.body).toEqual(new Uint8Array(JPEG_HEADER));
    });

    it("stores the CANONICAL mime type, not the client's claim", async () => {
      const { user, invitationId } = await owned();

      // A PNG announced as image/jpeg. The bytes decide what gets recorded.
      await service.upload(
        user.scope,
        invitationId,
        "gallery",
        part({
          originalname: "photo.jpg",
          mimetype: "image/jpeg",
          buffer: PNG_HEADER,
        }),
      );

      expect((await mediaRows(invitationId))[0]!.mime_type).toBe("image/png");
    });

    it("enqueues media.process on the media pool, after the object exists", async () => {
      const { user, invitationId } = await owned();

      const result = await service.upload(
        user.scope,
        invitationId,
        "cover",
        part(),
      );

      expect(enqueued).toEqual([
        { pool: "media", name: "media.process", data: { mediaId: result.id } },
      ]);
    });

    it("writes nothing to the permanent bucket", async () => {
      // BR-8.2 and `docs/SECURITY/06`'s safe flow: staging only until the worker has
      // scanned, decoded and stripped. This stage must not be able to publish.
      const { user, invitationId } = await owned();

      await service.upload(user.scope, invitationId, "gallery", part());

      expect(storage.keys("user-media")).toEqual([]);
      expect(stagingKeys()).toHaveLength(1);
    });
  });

  // ----------------------------------------------------- layer 8, the filename

  describe("the storage path (docs/SECURITY/06 layer 8)", () => {
    it("contains no part of the client's filename", async () => {
      const { user, invitationId } = await owned();

      const result = await service.upload(
        user.scope,
        invitationId,
        "gallery",
        part({ originalname: "../../../etc/passwd.jpg" }),
      );

      const path = (await mediaRows(invitationId))[0]!.storage_path;
      expect(path).toBe(`uploads/${result.id}`);
      expect(path).not.toContain("..");
      expect(path).not.toContain("passwd");
      expect(stagingKeys()).toEqual([`uploads/${result.id}`]);
    });

    it("is a staging path, never a media path", async () => {
      const { user, invitationId } = await owned();

      await service.upload(user.scope, invitationId, "gallery", part());

      const path = (await mediaRows(invitationId))[0]!.storage_path;
      expect(path.startsWith("uploads/")).toBe(true);
      expect(path).not.toContain("invitations/");
    });
  });

  // ------------------------------------------------------------- the rejections

  describe("refusing a file", () => {
    it("a PHP webshell renamed .jpg is rejected at the magic-byte check", async () => {
      const { user, invitationId } = await owned();

      const error = await rejection(() =>
        service.upload(
          user.scope,
          invitationId,
          "gallery",
          part({ originalname: "shell.jpg", buffer: PHP_SHELL }),
        ),
      );

      expect(error).toMatchObject({ status: 400, code: "INVALID_FILE_TYPE" });
      expect(await mediaRows(invitationId)).toHaveLength(0);
      expect(stagingKeys()).toEqual([]);
    });

    it("a spoofed Content-Type does not rescue bytes that are not an image", async () => {
      const { user, invitationId } = await owned();

      const error = await rejection(() =>
        service.upload(
          user.scope,
          invitationId,
          "gallery",
          part({
            originalname: "shell.jpg",
            mimetype: "image/jpeg",
            buffer: PHP_SHELL,
          }),
        ),
      );

      expect(error).toMatchObject({ code: "INVALID_FILE_TYPE" });
    });

    it("an extension outside the allowlist is rejected before the bytes are read", async () => {
      const { user, invitationId } = await owned();

      const error = await rejection(() =>
        service.upload(
          user.scope,
          invitationId,
          "gallery",
          // Real JPEG bytes, so only the extension can be the reason.
          part({ originalname: "photo.gif" }),
        ),
      );

      expect(error).toMatchObject({ code: "INVALID_FILE_TYPE" });
      expect(await mediaRows(invitationId)).toHaveLength(0);
    });

    it("an oversized file is rejected with FILE_TOO_LARGE", async () => {
      const { user, invitationId } = await owned();

      const error = await rejection(() =>
        service.upload(
          user.scope,
          invitationId,
          "gallery",
          part({ size: 11 * 1024 * 1024 }),
        ),
      );

      expect(error).toMatchObject({ status: 400, code: "FILE_TOO_LARGE" });
      expect(stagingKeys()).toEqual([]);
    });

    it("every rejection uses the same code for every content reason", async () => {
      // Telling a caller WHICH layer refused them is telling an attacker which layer to
      // work around. A legitimate user only needs to know the file is not a jpg.
      const { user, invitationId } = await owned();

      const byExtension = await rejection(() =>
        service.upload(
          user.scope,
          invitationId,
          "gallery",
          part({ originalname: "x.gif" }),
        ),
      );
      const byBytes = await rejection(() =>
        service.upload(
          user.scope,
          invitationId,
          "gallery",
          part({ buffer: PHP_SHELL }),
        ),
      );

      expect((byExtension as { code: string }).code).toBe(
        (byBytes as { code: string }).code,
      );
      expect((byExtension as { message: string }).message).toBe(
        (byBytes as { message: string }).message,
      );
    });
  });

  // ------------------------------------------------------------ BR-8.1, quota

  describe("the quota (BR-8.1)", () => {
    /** Fill an invitation to `count` media rows without going through the service. */
    const fill = async (
      invitationId: string,
      count: number,
      status = "ready",
    ) => {
      const values = Array.from({ length: count }, (_, i) => i);
      for (const i of values) {
        await harness.pool.query(
          `INSERT INTO media (invitation_id, purpose, status, storage_path)
           VALUES ($1, 'gallery', $2, $3)`,
          [invitationId, status, `uploads/filler-${String(i)}`],
        );
      }
    };

    it("refuses the upload that would exceed it", async () => {
      const { user, invitationId } = await owned();
      await fill(invitationId, MAX_PHOTOS_PER_INVITATION);

      const error = await rejection(() =>
        service.upload(user.scope, invitationId, "gallery", part()),
      );

      expect(error).toMatchObject({ status: 400, code: "QUOTA_EXCEEDED" });
      expect(stagingKeys()).toEqual([]);
    });

    it("allows the last one under the limit", async () => {
      const { user, invitationId } = await owned();
      await fill(invitationId, MAX_PHOTOS_PER_INVITATION - 1);

      const result = await service.upload(
        user.scope,
        invitationId,
        "gallery",
        part(),
      );

      expect(result.status).toBe("processing");
    });

    it("a failed upload does not occupy a slot", async () => {
      // `docs/BACKEND/04` Stage 2 step 9 deletes the file when it sets 'failed', so the row
      // holds no storage. Counting it would shrink a quota for photos that do not exist.
      const { user, invitationId } = await owned();
      await fill(invitationId, MAX_PHOTOS_PER_INVITATION, "failed");

      const result = await service.upload(
        user.scope,
        invitationId,
        "gallery",
        part(),
      );

      expect(result.status).toBe("processing");
    });

    it("a soft-deleted photo does not occupy a slot", async () => {
      const { user, invitationId } = await owned();
      await fill(invitationId, MAX_PHOTOS_PER_INVITATION);
      await harness.pool.query(
        "UPDATE media SET deleted_at = now() WHERE invitation_id = $1",
        [invitationId],
      );

      const result = await service.upload(
        user.scope,
        invitationId,
        "gallery",
        part(),
      );

      expect(result.status).toBe("processing");
    });

    it("eight uploads racing for one remaining slot leave the cap intact", async () => {
      // The behavioural half of the quota guarantee, and **on its own it does not prove the
      // lock**. Measured: this test passes with `FOR UPDATE` removed, at two callers and at
      // eight — node-postgres and the FK's own `FOR KEY SHARE` happen to serialise the
      // inserts often enough that the race does not occur. Naming it "cannot both succeed"
      // would have been a claim the test cannot support.
      //
      // `"the upload takes a conflicting row lock on the invitation"` below is what proves
      // the lock, deterministically. This one asserts the outcome anybody actually cares
      // about: 200 means 200.
      const parallel = 8;
      const { user, invitationId } = await owned();
      await fill(invitationId, MAX_PHOTOS_PER_INVITATION - 1);

      const results = await Promise.allSettled(
        Array.from({ length: parallel }, () =>
          service.upload(user.scope, invitationId, "gallery", part()),
        ),
      );

      const accepted = results.filter((r) => r.status === "fulfilled");
      const refused = results.filter((r) => r.status === "rejected");

      expect(accepted).toHaveLength(1);
      expect(refused).toHaveLength(parallel - 1);
      for (const failure of refused) {
        expect((failure as PromiseRejectedResult).reason).toMatchObject({
          code: "QUOTA_EXCEEDED",
        });
      }

      // The claim that actually matters: the cap held. An off-by-one here is a couple with
      // 207 photos and a storage bill nobody predicted.
      const { rows } = await harness.pool.query<{ total: string }>(
        "SELECT count(*) AS total FROM media WHERE invitation_id = $1 AND status <> 'failed'",
        [invitationId],
      );
      expect(Number(rows[0]!.total)).toBe(MAX_PHOTOS_PER_INVITATION);
    });

    it("the upload takes a conflicting row lock on the invitation", async () => {
      // The deterministic proof, because the race above is not one.
      //
      // The probe holds `FOR NO KEY UPDATE` on the invitation row. That conflicts with
      // `FOR UPDATE` and does **not** conflict with the `FOR KEY SHARE` that the media
      // INSERT's foreign key takes on its own — so an upload that blocks here can only be
      // blocking on the quota lock, and an upload that sails through is one that never took
      // it. A `FOR UPDATE` probe would have proved nothing: the FK lock conflicts with that
      // one, so the upload would block either way.
      const { user, invitationId } = await owned();
      const probe = await harness.pool.connect();

      try {
        await probe.query("BEGIN");
        await probe.query(
          "SELECT id FROM invitations WHERE id = $1 FOR NO KEY UPDATE",
          [invitationId],
        );

        let settled = false;
        const upload = service
          .upload(user.scope, invitationId, "gallery", part())
          .then((result) => {
            settled = true;
            return result;
          });

        // A real wait, not a tick: the point is that it had every opportunity to finish.
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(settled).toBe(false);

        await probe.query("COMMIT");
        await expect(upload).resolves.toMatchObject({ status: "processing" });
      } finally {
        probe.release();
      }
    });
  });

  // --------------------------------------------------------------- the storage failure

  describe("when staging cannot be written", () => {
    it("marks the row failed rather than leaving it processing forever", async () => {
      const { user, invitationId } = await owned();
      const failing = {
        ...storage,
        put: async () => {
          throw new Error("bucket unreachable");
        },
      } as unknown as InMemoryStorage;
      const brittle = new MediaService(repository, failing, queue, env);

      await rejection(() =>
        brittle.upload(user.scope, invitationId, "gallery", part()),
      );

      const rows = await mediaRows(invitationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("failed");
      expect(enqueued).toEqual([]);
    });
  });

  // ----------------------------------------------------------------- reading

  describe("GET media/:media_id", () => {
    it("returns the processing shape with no url", async () => {
      // A processing row has not been decoded. `url: null` would invite a client to render
      // it; an absent field is something the client has to handle.
      const { user, invitationId } = await owned();
      const created = await service.upload(
        user.scope,
        invitationId,
        "gallery",
        part(),
      );

      const detail = await service.get(user.scope, created.id);

      expect(detail).toEqual({
        id: created.id,
        status: "processing",
        purpose: "gallery",
      });
    });

    it("returns CDN urls once the row is ready", async () => {
      const { user, invitationId } = await owned();
      const created = await service.upload(
        user.scope,
        invitationId,
        "gallery",
        part(),
      );
      await harness.pool.query(
        "UPDATE media SET status = 'ready', width = 1600, height = 1200 WHERE id = $1",
        [created.id],
      );

      const detail = await service.get(user.scope, created.id);

      expect(detail.url).toBe(
        `https://cdn.test/invitations/${invitationId}/media/${created.id}/large.webp`,
      );
      expect(detail.thumbnail_url).toBe(
        `https://cdn.test/invitations/${invitationId}/media/${created.id}/thumbnail.webp`,
      );
      expect(detail.width).toBe(1600);
    });

    it("omits the urls when no CDN is configured", async () => {
      // `docs/ARCHITECTURE/05` forbids handing out a bucket URL, so there is no
      // second-best source to fall back to. Emitting a link against a host that does not
      // serve it would be worse than omitting the field.
      const { user, invitationId } = await owned();
      const noCdn = new MediaService(repository, storage, queue, {} as Env);
      const created = await noCdn.upload(
        user.scope,
        invitationId,
        "gallery",
        part(),
      );
      await harness.pool.query(
        "UPDATE media SET status = 'ready' WHERE id = $1",
        [created.id],
      );

      const detail = await noCdn.get(user.scope, created.id);

      expect(detail.url).toBeUndefined();
      expect(detail.status).toBe("ready");
    });

    it("a soft-deleted photo is 404", async () => {
      const { user, invitationId } = await owned();
      const created = await service.upload(
        user.scope,
        invitationId,
        "gallery",
        part(),
      );
      await harness.pool.query(
        "UPDATE media SET deleted_at = now() WHERE id = $1",
        [created.id],
      );

      const error = await rejection(() => service.get(user.scope, created.id));
      expect(error).toMatchObject({ status: 404 });
    });
  });

  // -------------------------------------------------------------------- IDOR

  describe("cross-tenant access (docs/SECURITY/05)", () => {
    it("uploading to another user's invitation is 404 and stores nothing", async () => {
      const alice = await owned();
      const mallory = await owned();

      await expectServiceIdorSafe(() =>
        service.upload(
          mallory.user.scope,
          alice.invitationId,
          "gallery",
          part(),
        ),
      );

      expect(await mediaRows(alice.invitationId)).toHaveLength(0);
      expect(stagingKeys()).toEqual([]);
    });

    it("another user's media is 404", async () => {
      const alice = await owned();
      const mallory = await owned();
      const created = await service.upload(
        alice.user.scope,
        alice.invitationId,
        "gallery",
        part(),
      );

      await expectServiceIdorSafe(
        () => service.get(mallory.user.scope, created.id),
        { mustNotContain: [created.id] },
      );
    });

    it("a template asset is not readable through the owner endpoint", async () => {
      // `media.invitation_id IS NULL` marks a template asset (`docs/DATABASE/06`). It has no
      // owner, so no owner may read it here -- and the inner join makes that structural
      // rather than a condition somebody has to remember.
      const { user } = await owned();
      const { rows } = await harness.pool.query<{ id: string }>(
        `INSERT INTO media (invitation_id, purpose, status, storage_path)
         VALUES (NULL, 'template', 'ready', 'uploads/asset') RETURNING id`,
      );

      expect(
        await repository.findOwnedMedia(rows[0]!.id, user.scope),
      ).toBeNull();
    });

    it("the repository refuses a foreign scope on the insert, not only the service", async () => {
      // P1-12's lesson: the service's own check masks the repository's. Removing the owner
      // predicate from the quota lock must fail HERE.
      const alice = await owned();
      const mallory = await owned();

      const result = await repository.insertMediaWithinQuota(
        alice.invitationId,
        mallory.user.scope,
        {
          mediaId: "11111111-1111-4111-8111-111111111111",
          purpose: "gallery",
          storagePath: "uploads/11111111-1111-4111-8111-111111111111",
          mimeType: "image/jpeg",
          sizeBytes: 6,
          maxPhotos: MAX_PHOTOS_PER_INVITATION,
        },
      );

      expect(result).toBeNull();
      expect(await mediaRows(alice.invitationId)).toHaveLength(0);
    });

    it("markMediaFailed refuses a foreign scope", async () => {
      const alice = await owned();
      const mallory = await owned();
      const created = await service.upload(
        alice.user.scope,
        alice.invitationId,
        "gallery",
        part(),
      );

      await repository.markMediaFailed(created.id, mallory.user.scope);

      expect((await mediaRows(alice.invitationId))[0]!.status).toBe(
        "processing",
      );
    });
  });
});
