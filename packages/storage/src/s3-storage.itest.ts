import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { S3Storage } from "./s3-storage.js";
import { mediaKey, stagingKey, templateAssetKey } from "./paths.js";

/**
 * P0-16 — the S3 implementation against real MinIO.
 *
 * Two of the DoD items are claims about infrastructure, not code: "a direct request to a
 * bucket object URL is denied" and "the staging area is separate and not publicly
 * reachable". Neither can be verified against a fake -- the fake is ours and would say
 * whatever we built it to say.
 *
 *   docker compose -f deploy/docker-compose.yml up -d minio minio-init
 */

const ENDPOINT = process.env["STORAGE_ENDPOINT"] ?? "http://localhost:9000";

const INV = "11111111-1111-4111-8111-111111111111";
const MED = "22222222-2222-4222-8222-222222222222";
const TPL = "33333333-3333-4333-8333-333333333333";

let storage: S3Storage;

beforeAll(async () => {
  storage = new S3Storage({
    endpoint: ENDPOINT,
    accessKeyId: process.env["STORAGE_ACCESS_KEY_ID"] ?? "minio_dev",
    secretAccessKey:
      process.env["STORAGE_SECRET_ACCESS_KEY"] ?? "minio_dev_password",
    buckets: {
      "user-media": "user-media",
      "template-assets": "template-assets",
      staging: "staging",
    },
  });

  try {
    await storage.exists("user-media", mediaKey(INV, MED, "large"));
  } catch (cause) {
    throw new Error(
      [
        `Cannot reach object storage at ${ENDPOINT}`,
        "",
        "These tests do not skip when MinIO is missing: two of the P0-16 DoD items are",
        "claims about the infrastructure, and a fake cannot verify them.",
        "",
        "  docker compose -f deploy/docker-compose.yml up -d minio minio-init",
        "",
      ].join("\n"),
      { cause },
    );
  }
});

afterAll(async () => {
  for (const [bucket, key] of [
    ["user-media", mediaKey(INV, MED, "large")],
    ["user-media", mediaKey(INV, MED, "thumbnail")],
    ["staging", stagingKey(MED)],
    ["template-assets", templateAssetKey(TPL, "1.0.0", "bg.png")],
  ] as const) {
    await storage.delete(bucket, key).catch(() => {});
  }
});

describe("round trip", () => {
  it("stores and reads an object back", async () => {
    const key = mediaKey(INV, MED, "large");
    const body = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

    await storage.put("user-media", key, body, {
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    });

    const got = await storage.get("user-media", key);
    expect(got?.body).toEqual(body);
    expect(got?.contentType).toBe("image/webp");
  });

  it("returns null for a missing object rather than throwing", async () => {
    expect(
      await storage.get("user-media", mediaKey(INV, MED, "medium")),
    ).toBeNull();
  });

  it("treats deleting a missing object as success", async () => {
    // S3 delete is idempotent. A cleanup job retried after a partial success must not
    // fail on its second run.
    await expect(
      storage.delete("user-media", mediaKey(INV, MED, "original")),
    ).resolves.toBeUndefined();
  });
});

describe("buckets are private (docs/ARCHITECTURE/05 § Access Control)", () => {
  it("denies an unauthenticated GET of a real object", async () => {
    // The DoD item. The object genuinely exists and the URL is genuinely correct -- the
    // only thing standing between it and the internet is the bucket policy.
    const key = mediaKey(INV, MED, "thumbnail");
    await storage.put("user-media", key, new Uint8Array([1]), {
      contentType: "image/webp",
    });

    const response = await fetch(`${ENDPOINT}/user-media/${key}`);

    expect(response.status).toBe(403);
    expect(response.status).not.toBe(200);
  });

  it("denies an unauthenticated GET against the staging bucket", async () => {
    // docs/BACKEND/04 Stage 1 step 5: staging is "not public-accessible". The file here
    // has passed only the extension, MIME and magic-byte checks -- it has NOT been
    // malware-scanned, which is exactly why it must not be fetchable.
    const key = stagingKey(MED);
    await storage.put("staging", key, new Uint8Array([1]), {
      contentType: "image/jpeg",
    });

    const response = await fetch(`${ENDPOINT}/staging/${key}`);
    expect(response.status).toBe(403);
  });

  it("denies listing a bucket anonymously", async () => {
    // Listing would enumerate every invitation id in the system, which is the
    // enumeration docs/SECURITY/06 uses UUID media ids to prevent.
    const response = await fetch(`${ENDPOINT}/user-media/`);
    expect(response.status).toBe(403);
  });

  it("a signed URL does work, and carries an expiry", async () => {
    // The sanctioned alternative. Proves the 403s above are the bucket policy rather
    // than a broken endpoint -- without this, all three could pass against a MinIO that
    // was simply down.
    const key = mediaKey(INV, MED, "thumbnail");
    const url = await storage.presignGet("user-media", key, 60);

    expect(url).toContain("X-Amz-Signature");
    expect(url).toContain("X-Amz-Expires=60");

    const response = await fetch(url);
    expect(response.status).toBe(200);
  });
});

describe("staging is separate", () => {
  it("does not resolve a staging key inside user-media", async () => {
    const key = stagingKey(MED);
    await storage.put("staging", key, new Uint8Array([1]), {
      contentType: "image/jpeg",
    });

    expect(await storage.exists("staging", key)).toBe(true);
    expect(await storage.exists("user-media", key)).toBe(false);
  });

  it("moves a validated upload out of staging, copying before deleting", async () => {
    const from = stagingKey(MED);
    const to = mediaKey(INV, MED, "large");
    const body = new Uint8Array([9, 9, 9]);

    await storage.put("staging", from, body, { contentType: "image/jpeg" });
    await storage.move(
      { bucket: "staging", key: from },
      { bucket: "user-media", key: to },
    );

    expect(await storage.exists("staging", from)).toBe(false);
    expect((await storage.get("user-media", to))?.body).toEqual(body);
  });
});
