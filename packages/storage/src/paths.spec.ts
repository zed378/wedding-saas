import { describe, it, expect } from "vitest";

import {
  mediaKey,
  templateAssetKey,
  stagingKey,
  parseStoredKey,
  InvalidStoragePathError,
  VARIANTS,
  type Variant,
} from "./paths.js";
import { InMemoryStorage } from "./in-memory-storage.js";

/**
 * P0-16 — the path scheme, and the reasons it is validated rather than formatted.
 *
 * `docs/ARCHITECTURE/05` says the path carries `invitation_id` "for isolation & audit
 * purposes". That makes path construction a tenant isolation control, and the tests
 * below treat it as one: the interesting cases are the inputs that would put one
 * couple's photo somewhere it does not belong.
 */

const INV = "11111111-1111-4111-8111-111111111111";
const MED = "22222222-2222-4222-8222-222222222222";
const TPL = "33333333-3333-4333-8333-333333333333";

describe("mediaKey — docs/ARCHITECTURE/05 § Path Structure", () => {
  it("builds the documented path exactly", () => {
    // user-media/invitations/{invitation_id}/media/{media_id}/{variant}.webp
    expect(mediaKey(INV, MED, "large")).toBe(
      `invitations/${INV}/media/${MED}/large.webp`,
    );
  });

  it.each(VARIANTS)("accepts the %s variant", (variant) => {
    expect(mediaKey(INV, MED, variant)).toContain(`/${variant}.webp`);
  });

  it("always ends in .webp", () => {
    // docs/BACKEND/04 step 6 generates every variant in WebP, so the extension is not a
    // parameter. Making it one would invite storing whatever the user uploaded under
    // whatever extension they claimed.
    for (const variant of VARIANTS) {
      expect(mediaKey(INV, MED, variant).endsWith(".webp")).toBe(true);
    }
  });

  it("rejects a variant that is not in the set", () => {
    expect(() => mediaKey(INV, MED, "huge" as Variant)).toThrow(
      InvalidStoragePathError,
    );
  });

  it.each([
    ["not-a-uuid", "an id that is not a UUID"],
    ["", "an empty id"],
    ["../../../etc", "a traversal attempt"],
    [
      "11111111-1111-4111-8111-111111111111/../../other",
      "a traversal after a valid prefix",
    ],
    ["*", "a wildcard"],
  ])("rejects %s as an invitation id (%s)", (bad) => {
    // The one that matters most is the traversal-after-valid-prefix case: a naive
    // `startsWith` check on the id would pass it, and the object would land outside the
    // invitation's prefix -- one couple's photo filed under another's, or nowhere
    // findable at all.
    expect(() => mediaKey(bad, MED, "large")).toThrow(InvalidStoragePathError);
  });

  it("rejects a bad media id just as firmly as a bad invitation id", () => {
    expect(() => mediaKey(INV, "../secrets", "large")).toThrow(
      InvalidStoragePathError,
    );
  });

  it("normalises case, so one object has one key", () => {
    // Two spellings of the same UUID would be two objects in S3 -- a duplicate upload
    // that no cleanup job would ever connect to its twin.
    expect(mediaKey(INV.toUpperCase(), MED.toUpperCase(), "thumbnail")).toBe(
      mediaKey(INV, MED, "thumbnail"),
    );
  });

  it("keeps two invitations' media in separate prefixes", () => {
    const other = "44444444-4444-4444-8444-444444444444";
    expect(mediaKey(INV, MED, "large")).not.toContain(other);
    expect(mediaKey(other, MED, "large")).not.toContain(INV);
  });
});

describe("templateAssetKey", () => {
  it("builds the documented path exactly", () => {
    // template-assets/templates/{template_id}/versions/{version}/assets/{asset_name}
    expect(templateAssetKey(TPL, "1.2.0", "hero-bg.jpg")).toBe(
      `templates/${TPL}/versions/1.2.0/assets/hero-bg.jpg`,
    );
  });

  it.each(["1", "1.2", "v1.2.0", "latest", "1.2.0-beta", ""])(
    "rejects %s as a version",
    (version) => {
      expect(() => templateAssetKey(TPL, version, "a.jpg")).toThrow(
        InvalidStoragePathError,
      );
    },
  );

  it.each([
    "../../../etc/passwd",
    "a/b.jpg",
    "sub/dir/file.png",
    ".hidden",
    "noextension",
    "with space.jpg",
  ])("rejects %s as an asset name", (name) => {
    // A name containing a separator lets an asset escape its version's prefix and land
    // anywhere in the bucket -- path traversal wearing an S3 hat.
    expect(() => templateAssetKey(TPL, "1.0.0", name)).toThrow(
      InvalidStoragePathError,
    );
  });

  it.each(["hero-bg.jpg", "icon_2.png", "demo.photo.webp", "a1.svg"])(
    "accepts %s as an asset name",
    (name) => {
      expect(templateAssetKey(TPL, "1.0.0", name)).toContain(`/assets/${name}`);
    },
  );
});

describe("stagingKey — docs/BACKEND/04 Stage 1 step 5", () => {
  it("keys a not-yet-validated upload by media id alone", () => {
    expect(stagingKey(MED)).toBe(`uploads/${MED}`);
  });

  it("does not share a prefix with permanent media", () => {
    // A staging file has passed only the extension, MIME and magic-byte checks. It has
    // not been malware-scanned, decoded, or had its EXIF stripped -- so it must not be
    // reachable from anything that looks like a media path.
    expect(stagingKey(MED).startsWith("invitations/")).toBe(false);
    expect(mediaKey(INV, MED, "large").startsWith("uploads/")).toBe(false);
  });

  it("rejects a non-UUID media id", () => {
    expect(() => stagingKey("../../evil")).toThrow(InvalidStoragePathError);
  });
});

describe("parseStoredKey — the escape hatch, validated", () => {
  it("accepts keys the builders produce", () => {
    for (const key of [
      mediaKey(INV, MED, "medium"),
      templateAssetKey(TPL, "2.0.1", "bg.png"),
      stagingKey(MED),
    ]) {
      expect(parseStoredKey(key)).toBe(key);
    }
  });

  it.each([
    "invitations/../../../etc/passwd",
    "arbitrary/object",
    "invitations/not-a-uuid/media/x/large.webp",
    `invitations/${INV}/media/${MED}/large.exe`,
    "",
  ])("rejects %s", (bad) => {
    // media.storage_path is a database column. A corrupted or hand-edited row must not
    // become a request for an arbitrary object.
    expect(() => parseStoredKey(bad)).toThrow(InvalidStoragePathError);
  });
});

describe("InMemoryStorage — a faithful fake", () => {
  const store = new InMemoryStorage();
  const key = mediaKey(INV, MED, "large");
  const body = new Uint8Array([1, 2, 3]);

  it("round-trips an object", async () => {
    store.clear();
    await store.put("user-media", key, body, { contentType: "image/webp" });

    const got = await store.get("user-media", key);
    expect(got?.body).toEqual(body);
    expect(got?.contentType).toBe("image/webp");
    expect(got?.contentLength).toBe(3);
  });

  it("returns null for a missing object rather than throwing", async () => {
    store.clear();
    expect(await store.get("user-media", key)).toBeNull();
  });

  it("treats delete of a missing object as success, as S3 does", async () => {
    // A cleanup job retried after a partial success must not fail on its second run.
    store.clear();
    await expect(store.delete("user-media", key)).resolves.toBeUndefined();
  });

  it("keeps buckets separate", async () => {
    store.clear();
    await store.put("staging", stagingKey(MED), body, {
      contentType: "image/jpeg",
    });

    expect(await store.exists("staging", stagingKey(MED))).toBe(true);
    expect(await store.exists("user-media", stagingKey(MED))).toBe(false);
  });

  it("moves staging to permanent, copying before deleting", async () => {
    // The order is the point. A failed delete leaves an orphan the hourly cleanup
    // removes; a delete before the copy would lose the file outright.
    store.clear();
    const from = stagingKey(MED);
    await store.put("staging", from, body, { contentType: "image/jpeg" });

    await store.move(
      { bucket: "staging", key: from },
      { bucket: "user-media", key },
    );

    expect(await store.exists("staging", from)).toBe(false);
    expect((await store.get("user-media", key))?.body).toEqual(body);
  });

  it("bounds the signed URL expiry", async () => {
    store.clear();
    const url = await store.presignGet("user-media", key, 60);
    expect(url).toContain("expires=60");
  });
});
