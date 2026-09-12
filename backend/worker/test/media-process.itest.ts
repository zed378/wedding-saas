import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import sharp from "sharp";
import { InMemoryStorage, stagingKey, mediaKey } from "@wi/storage";

import { MediaRepository } from "../src/media/media-repository.js";
import { makeMediaProcessHandler } from "../src/media/media-process.handler.js";
import {
  makeCleanupStagingHandler,
  STRANDED_AFTER_MINUTES,
} from "../src/media/cleanup-staging.handler.js";
import { ScannerUnavailableError } from "../src/media/clamav.js";
import {
  inspect,
  UnprocessableImageError,
} from "../src/media/process-image.js";
import type { JobContext } from "../src/runner.js";

/**
 * P1-18 — `media.process` against the real schema.
 *
 * The claims this task makes are all about what happens to a file, and none of them can be
 * checked by inspecting a call: "no EXIF survives" is a statement about output bytes, "a
 * bomb is refused before decoding" is a statement about allocation, and "`ready` is reached
 * only after a scan" is a statement about ordering. So the images are real, sharp is real,
 * the database is real, and only ClamAV is a stub — because a container that downloads a
 * virus database on first start is not something a unit suite can wait for, and the protocol
 * itself is covered in `media-unit.spec.ts`.
 *
 * Fails rather than skips when Postgres is missing, for the same reason every other schema
 * suite in this repository does: a suite that skips reports green for controls nobody ran.
 */

const DATABASE_URL =
  process.env["MIGRATION_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgres://wedding_owner:wedding_owner_dev@localhost:5432/wedding";

const uniq = (): string =>
  `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;

/** The three sections a valid template version needs; the schema validates on write. */
const SECTIONS = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: [],
  },
];
const THEME = {
  colors: {
    primary: "#b76e79",
    secondary: "#f4ede4",
    accent: "#c9a876",
    text: "#2b2b2b",
  },
  typography: {
    heading_font: "Playfair Display",
    body_font: "Inter",
    scale: "default",
  },
  spacing: "comfortable",
  border_radius: "rounded",
};

const context: JobContext = {
  jobName: "media.process",
  attempt: 1,
  requestId: undefined,
};

const finalAttempt: JobContext = { ...context, attempt: 3 };

describe("media.process", () => {
  let pool: Pool;
  let repository: MediaRepository;
  let storage: InMemoryStorage;
  let invitationId: string;
  let userId: string;

  /** A real JPEG carrying EXIF, including a GPS tag. */
  let photoWithGps: Buffer;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    try {
      await pool.query("SELECT 1 FROM media LIMIT 1");
    } catch (cause) {
      await pool.end().catch(() => {});
      throw new Error(
        [
          `Cannot reach a migrated database at ${DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`,
          "",
          "  docker compose -f deploy/docker-compose.yml up -d postgres",
          "  pnpm --filter @wi/api db:migrate",
          "",
        ].join("\n"),
        { cause },
      );
    }

    repository = new MediaRepository(pool);

    photoWithGps = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .jpeg()
      .withMetadata({
        exif: {
          IFD0: { Copyright: "Budi dan Ani" },
          // The GPS IFD. `docs/SECURITY/09` treats these coordinates as a home address.
          IFD3: {
            GPSLatitudeRef: "S",
            GPSLatitude: "6/1 12/1 30/1",
            GPSLongitudeRef: "E",
            GPSLongitude: "106/1 49/1 0/1",
          },
        },
      })
      .toBuffer();

    // The fixture is only meaningful if the input really carries EXIF.
    const source = await sharp(photoWithGps).metadata();
    expect(source.exif).toBeDefined();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    storage = new InMemoryStorage();

    const { rows: users } = await pool.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Budi') RETURNING id",
      [`worker-${uniq()}@example.test`],
    );
    userId = users[0]!.id;

    const { rows: templates } = await pool.query<{ id: string }>(
      "INSERT INTO templates (slug, name, status) VALUES ($1, 'T', 'published') RETURNING id",
      [`tpl-${uniq()}`],
    );
    const { rows: versions } = await pool.query<{ id: string }>(
      `INSERT INTO template_versions (template_id, version, sections, theme, status)
       VALUES ($1, '1.0.0', $2::jsonb, $3::jsonb, 'published') RETURNING id`,
      [templates[0]!.id, JSON.stringify(SECTIONS), JSON.stringify(THEME)],
    );
    const { rows: invitations } = await pool.query<{ id: string }>(
      "INSERT INTO invitations (owner_id, template_id, template_version_id) VALUES ($1, $2, $3) RETURNING id",
      [userId, templates[0]!.id, versions[0]!.id],
    );
    invitationId = invitations[0]!.id;
  });

  /** A `processing` media row with its bytes in staging, exactly as `P1-17` leaves it. */
  const stage = async (
    bytes: Buffer,
    options: { invitation?: string | null; createdAt?: string } = {},
  ): Promise<string> => {
    const invitation =
      options.invitation === undefined ? invitationId : options.invitation;

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO media (invitation_id, uploaded_by, purpose, status, storage_path, mime_type, size_bytes, created_at)
       VALUES ($1, $2, 'gallery', 'processing', 'placeholder', 'image/jpeg', $3, COALESCE($4::timestamptz, now()))
       RETURNING id`,
      [invitation, userId, bytes.length, options.createdAt ?? null],
    );
    const mediaId = rows[0]!.id;

    const key = stagingKey(mediaId);
    await pool.query("UPDATE media SET storage_path = $2 WHERE id = $1", [
      mediaId,
      key,
    ]);
    await storage.put("staging", key, new Uint8Array(bytes), {
      contentType: "image/jpeg",
    });

    return mediaId;
  };

  const mediaRow = async (mediaId: string) => {
    const { rows } = await pool.query<{
      status: string;
      storage_path: string;
      width: number | null;
      height: number | null;
      size_bytes: string | null;
    }>("SELECT * FROM media WHERE id = $1", [mediaId]);
    return rows[0]!;
  };

  const SCANNER = { host: "stub", port: 3310 };

  /**
   * The handler with a scanner of the caller's choosing.
   *
   * The verdict is injected rather than produced by a container, because the **infected**
   * branch is otherwise reachable only by feeding real malware to a real clamd — which in
   * practice means it goes untested, and it is the branch that most needs a test. The
   * protocol that produces the verdict is covered twice over: against the reply strings in
   * `media-unit.spec.ts`, and against a real clamd with the EICAR file in `clamav.itest.ts`.
   */
  const handlerWith = (
    verdict: "clean" | "infected" | "unavailable" | "no-scanner",
    maxAttempts = 3,
  ) =>
    makeMediaProcessHandler({
      repository,
      storage,
      maxAttempts,
      clamav: verdict === "no-scanner" ? undefined : SCANNER,
      scan: async () => {
        if (verdict === "unavailable") {
          throw new ScannerUnavailableError("connection refused");
        }
        if (verdict === "infected") {
          return { verdict: "infected", signature: "Eicar-Test-Signature" };
        }
        return { verdict: "clean" };
      },
    });

  // ---------------------------------------------------------------- happy path

  describe("publishing a photo", () => {
    it("writes three WebP variants and marks the row ready", async () => {
      const mediaId = await stage(photoWithGps);

      await handlerWith("clean")({ mediaId }, context);

      const row = await mediaRow(mediaId);
      expect(row.status).toBe("ready");
      expect(row.width).toBe(1200);
      expect(row.height).toBe(900);

      for (const variant of ["thumbnail", "medium", "large"] as const) {
        const stored = await storage.get(
          "user-media",
          mediaKey(invitationId, mediaId, variant),
        );
        expect(stored, `${variant} should exist`).not.toBeNull();
        expect((await sharp(stored!.body).metadata()).format).toBe("webp");
      }
    });

    it("every variant is free of EXIF, GPS included", async () => {
      // docs/SECURITY/06 layer 7 and docs/SECURITY/09. sharp drops metadata by default,
      // which is precisely why this is asserted against the OUTPUT BYTES: a default is the
      // kind of thing a later "keep the orientation" change reverses without anybody
      // thinking about a couple's home address.
      const mediaId = await stage(photoWithGps);

      await handlerWith("clean")({ mediaId }, context);

      for (const variant of ["thumbnail", "medium", "large"] as const) {
        const stored = await storage.get(
          "user-media",
          mediaKey(invitationId, mediaId, variant),
        );
        const metadata = await sharp(stored!.body).metadata();
        expect(metadata.exif, `${variant} carries EXIF`).toBeUndefined();

        // Belt and braces: the raw tag text must not survive anywhere in the file, not
        // even outside a structure sharp would report as EXIF.
        const asText = Buffer.from(stored!.body).toString("latin1");
        expect(asText).not.toContain("Budi dan Ani");
        expect(asText).not.toContain("GPS");
      }
    });

    it("does not upscale a photo smaller than a variant width", async () => {
      const small = await sharp({
        create: {
          width: 120,
          height: 90,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .jpeg()
        .toBuffer();
      const mediaId = await stage(small);

      await handlerWith("clean")({ mediaId }, context);

      const large = await storage.get(
        "user-media",
        mediaKey(invitationId, mediaId, "large"),
      );
      expect((await sharp(large!.body).metadata()).width).toBe(120);
    });

    it("deletes the staging object once the row is ready", async () => {
      const mediaId = await stage(photoWithGps);

      await handlerWith("clean")({ mediaId }, context);

      expect(await storage.get("staging", stagingKey(mediaId))).toBeNull();
    });

    it("points storage_path at the permanent large variant", async () => {
      const mediaId = await stage(photoWithGps);

      await handlerWith("clean")({ mediaId }, context);

      expect((await mediaRow(mediaId)).storage_path).toBe(
        mediaKey(invitationId, mediaId, "large"),
      );
    });
  });

  // ------------------------------------------------------------ layers 5 and 6

  describe("refusing a file", () => {
    it("the dimension gate refuses the bomb at the HEADER, not during decode", async () => {
      // The discriminating test, and the reason it exists: the integration case below
      // asserts the row ends `failed`, which it does whether the refusal came from this
      // gate or from sharp's own `limitInputPixels` throwing mid-decode. Those are very
      // different outcomes -- one reads a few hundred bytes, the other starts allocating a
      // 4.8 GB buffer in the worker -- and only `inspect` on its own can tell them apart.
      const bomb = await sharp({
        create: {
          width: 40_000,
          height: 40_000,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
        limitInputPixels: false,
      })
        .png({ compressionLevel: 9 })
        .toBuffer();

      const error = await inspect(new Uint8Array(bomb)).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(UnprocessableImageError);
      expect((error as UnprocessableImageError).reason).toBe("dimensions");
    }, 180_000);

    it("a declared 40000x40000 image is refused before it is decoded", async () => {
      // docs/SECURITY/06 layer 5. The file is small; the buffer it would decode to is
      // 4.8 GB. The refusal has to happen at the header, not after the allocation.
      const bomb = await sharp({
        create: {
          width: 40_000,
          height: 40_000,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
        limitInputPixels: false,
      })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: false });

      const mediaId = await stage(bomb);

      await handlerWith("clean")({ mediaId }, context);

      expect((await mediaRow(mediaId)).status).toBe("failed");
      expect(storage.keys("user-media")).toEqual([]);
      expect(await storage.get("staging", stagingKey(mediaId))).toBeNull();
    }, 180_000);

    it("a file with a JPEG header and a script payload never becomes ready", async () => {
      // The polyglot `P1-17` accepts on purpose, arriving here. It has a valid signature
      // and is not an image, so the decode is what refuses it.
      const polyglot = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from('<?php system($_GET["c"]); ?>'),
      ]);
      const mediaId = await stage(polyglot);

      await handlerWith("clean")({ mediaId }, context);

      expect((await mediaRow(mediaId)).status).toBe("failed");
      expect(storage.keys("user-media")).toEqual([]);
    });

    it("a missing staging object fails the row rather than retrying forever", async () => {
      const mediaId = await stage(photoWithGps);
      await storage.delete("staging", stagingKey(mediaId));

      await handlerWith("clean")({ mediaId }, context);

      expect((await mediaRow(mediaId)).status).toBe("failed");
    });

    it("a template asset has no invitation and so cannot be published", async () => {
      const mediaId = await stage(photoWithGps, { invitation: null });

      await handlerWith("clean")({ mediaId }, context);

      expect((await mediaRow(mediaId)).status).toBe("failed");
      expect(storage.keys("user-media")).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- the scanner

  describe("the malware scan (docs/SECURITY/06 layer 10)", () => {
    it("an infected file is deleted and never becomes ready", async () => {
      const mediaId = await stage(photoWithGps);

      await handlerWith("infected")({ mediaId }, context);

      expect((await mediaRow(mediaId)).status).toBe("failed");
      // Nothing published, and the hostile bytes are gone from staging too -- keeping them
      // for "investigation" would mean keeping malware in a bucket nobody sweeps.
      expect(storage.keys("user-media")).toEqual([]);
      expect(await storage.get("staging", stagingKey(mediaId))).toBeNull();
    });

    it("an infected file is not retried into a different answer", async () => {
      // Infected is a verdict, not a transient condition. Retrying it three times is three
      // scans of a file already known to be hostile, and the third answer is the first one.
      const mediaId = await stage(photoWithGps);

      await expect(
        handlerWith("infected")({ mediaId }, context),
      ).resolves.toBeUndefined();

      expect((await mediaRow(mediaId)).status).toBe("failed");
    });

    it("a clean verdict is required before anything is published", async () => {
      // The ordering claim: the scan runs BEFORE the decode and the upload. If it did not,
      // an infected file would already have three variants in the permanent bucket by the
      // time the verdict arrived.
      const mediaId = await stage(photoWithGps);
      const order: string[] = [];

      await makeMediaProcessHandler({
        repository,
        // An explicit wrapper rather than a Proxy: `InMemoryStorage`'s methods touch
        // private state, and a Proxy hands them the proxy as `this`.
        storage: {
          put: async (...args: Parameters<InMemoryStorage["put"]>) => {
            order.push("put");
            return storage.put(...args);
          },
          get: (...args: Parameters<InMemoryStorage["get"]>) =>
            storage.get(...args),
          delete: (...args: Parameters<InMemoryStorage["delete"]>) =>
            storage.delete(...args),
          exists: (...args: Parameters<InMemoryStorage["exists"]>) =>
            storage.exists(...args),
          presignGet: (...args: Parameters<InMemoryStorage["presignGet"]>) =>
            storage.presignGet(...args),
          move: (...args: Parameters<InMemoryStorage["move"]>) =>
            storage.move(...args),
        },
        clamav: SCANNER,
        maxAttempts: 3,
        scan: async () => {
          order.push("scan");
          return { verdict: "clean" };
        },
      })({ mediaId }, context);

      expect(order[0]).toBe("scan");
      expect(order).toContain("put");
    });

    it("retries rather than deciding when the scanner is unreachable", async () => {
      const mediaId = await stage(photoWithGps);
      const handler = handlerWith("unavailable");

      await expect(handler({ mediaId }, context)).rejects.toThrow(
        ScannerUnavailableError,
      );

      // Crucially: still `processing`, and NOTHING published. Fail closed.
      expect((await mediaRow(mediaId)).status).toBe("processing");
      expect(storage.keys("user-media")).toEqual([]);
    });

    it("a file is never marked ready when the scanner is unavailable", async () => {
      const mediaId = await stage(photoWithGps);
      const handler = handlerWith("unavailable");

      await handler({ mediaId }, finalAttempt).catch(() => undefined);

      const row = await mediaRow(mediaId);
      expect(row.status).not.toBe("ready");
      expect(row.status).toBe("failed");
      expect(storage.keys("user-media")).toEqual([]);
    });

    it("the final attempt leaves an honest failed row rather than a stuck one", async () => {
      const mediaId = await stage(photoWithGps);

      await handlerWith("unavailable")({ mediaId }, finalAttempt);

      expect((await mediaRow(mediaId)).status).toBe("failed");
      // The staging file goes too: nothing will ever read it again.
      expect(await storage.get("staging", stagingKey(mediaId))).toBeNull();
    });
  });

  // ------------------------------------------------------------- idempotency

  describe("idempotency (docs/BACKEND/04 § Idempotency)", () => {
    it("a second run of the same job changes nothing", async () => {
      const mediaId = await stage(photoWithGps);
      const handler = handlerWith("clean");

      await handler({ mediaId }, context);
      const afterFirst = await mediaRow(mediaId);
      const keysAfterFirst = storage.keys("user-media").sort();

      await handler({ mediaId }, { ...context, attempt: 2 });

      expect(await mediaRow(mediaId)).toEqual(afterFirst);
      expect(storage.keys("user-media").sort()).toEqual(keysAfterFirst);
    });

    it("a row someone already failed is not resurrected", async () => {
      const mediaId = await stage(photoWithGps);
      await pool.query("UPDATE media SET status = 'failed' WHERE id = $1", [
        mediaId,
      ]);

      await handlerWith("clean")({ mediaId }, context);

      expect((await mediaRow(mediaId)).status).toBe("failed");
      expect(storage.keys("user-media")).toEqual([]);
    });

    it("a row that no longer exists is not an error", async () => {
      const mediaId = await stage(photoWithGps);
      await pool.query("DELETE FROM media WHERE id = $1", [mediaId]);

      await expect(
        handlerWith("clean")({ mediaId }, context),
      ).resolves.toBeUndefined();
    });
  });

  // ------------------------------------------------ the repository, on its own

  describe("the conditional writes", () => {
    /**
     * Tested directly, because the handler masks them.
     *
     * A mutation removing `WHERE status = 'processing'` from `markReady` passed all
     * twenty-one tests above: the handler returns early on a row that is not `processing`,
     * so the repository's guard is never the thing that refuses. That is `P1-12`'s finding
     * again — defence in depth makes each layer untestable from outside — and the guard
     * matters precisely in the case the handler cannot reach: two runs genuinely in flight
     * at once, where the early return has already been passed by both.
     */
    it("markReady refuses a row that is no longer processing", async () => {
      const mediaId = await stage(photoWithGps);
      await pool.query("UPDATE media SET status = 'failed' WHERE id = $1", [
        mediaId,
      ]);

      const written = await repository.markReady(mediaId, {
        storagePath: "invitations/x/media/y/large.webp",
        width: 1,
        height: 1,
        sizeBytes: 1,
      });

      expect(written).toBe(false);
      // The important half: a row somebody decided was `failed` is not resurrected by a
      // late worker finishing work that was already abandoned.
      expect((await mediaRow(mediaId)).status).toBe("failed");
    });

    it("markReady refuses a row that is already ready", async () => {
      const mediaId = await stage(photoWithGps);
      await repository.markReady(mediaId, {
        storagePath: "invitations/x/media/y/large.webp",
        width: 100,
        height: 80,
        sizeBytes: 500,
      });

      const second = await repository.markReady(mediaId, {
        storagePath: "invitations/z/media/z/large.webp",
        width: 999,
        height: 999,
        sizeBytes: 1,
      });

      expect(second).toBe(false);
      const row = await mediaRow(mediaId);
      expect(row.width).toBe(100);
      expect(row.storage_path).toBe("invitations/x/media/y/large.webp");
    });

    it("markFailed refuses a row that is already ready", async () => {
      // The other direction, and the one that would be a visible product bug: a stale
      // retry turning a published photo into a failed upload.
      const mediaId = await stage(photoWithGps);
      await repository.markReady(mediaId, {
        storagePath: "invitations/x/media/y/large.webp",
        width: 100,
        height: 80,
        sizeBytes: 500,
      });

      expect(await repository.markFailed(mediaId)).toBe(false);
      expect((await mediaRow(mediaId)).status).toBe("ready");
    });

    it("markReady succeeds exactly once under two concurrent callers", async () => {
      const mediaId = await stage(photoWithGps);
      const values = {
        storagePath: "invitations/x/media/y/large.webp",
        width: 10,
        height: 10,
        sizeBytes: 10,
      };

      const results = await Promise.all([
        repository.markReady(mediaId, values),
        repository.markReady(mediaId, values),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------- the hourly sweep

  describe("media_cleanup_staging", () => {
    it("clears an upload stranded longer than an hour", async () => {
      const mediaId = await stage(photoWithGps, {
        createdAt: new Date(
          Date.now() - (STRANDED_AFTER_MINUTES + 5) * 60_000,
        ).toISOString(),
      });

      await makeCleanupStagingHandler({ repository, storage })();

      // Both halves: the file is gone AND the row is settled, so the owner stops polling
      // and P1-17's quota gives the slot back.
      expect(await storage.get("staging", stagingKey(mediaId))).toBeNull();
      expect((await mediaRow(mediaId)).status).toBe("failed");
    });

    it("leaves an upload that is merely in flight alone", async () => {
      const mediaId = await stage(photoWithGps);

      await makeCleanupStagingHandler({ repository, storage })();

      expect(await storage.get("staging", stagingKey(mediaId))).not.toBeNull();
      expect((await mediaRow(mediaId)).status).toBe("processing");
    });
  });
});
