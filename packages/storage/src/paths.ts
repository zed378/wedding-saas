/**
 * Storage paths. `docs/ARCHITECTURE/05` § Path Structure.
 *
 * ```
 * user-media/
 *   invitations/{invitation_id}/media/{media_id}/{variant}.webp
 *
 * template-assets/
 *   templates/{template_id}/versions/{version}/assets/{asset_name}
 * ```
 *
 * **Path construction is a tenant isolation control, not a formatting concern.** The
 * document is explicit that the path carries `invitation_id` "for isolation & audit
 * purposes". A path assembled at a call site is a path where someone can interpolate the
 * wrong id, or an id that came straight from a request body — and the result is one
 * couple's photos filed under another couple's invitation, discovered months later or
 * never.
 *
 * So the builders below are the only way to name an object, every argument is validated
 * as a UUID or a strict identifier, and `StoragePort` accepts a `StorageKey` rather than
 * a string. A caller who has a string does not have a key.
 */

/** A validated object key. Only `paths.ts` can produce one. */
declare const StorageKeyBrand: unique symbol;
export type StorageKey = string & { readonly [StorageKeyBrand]: true };

export type Bucket = "user-media" | "template-assets" | "staging";

/**
 * Image variants.
 *
 * The union of what two documents say, because they disagree: `docs/ARCHITECTURE/05`
 * § Path Structure lists `original | large | thumbnail`, while `docs/BACKEND/04` step 6
 * generates `thumbnail (300px) | medium (800px) | large (1600px)`. Neither is a superset
 * of the other -- `medium` is missing from one, `original` from the other.
 *
 * Accepting all four here is deliberate: the path builder should permit anything either
 * document sanctions, and *which* variants are actually produced is `P1-17`'s decision.
 * Narrowing it now would mean guessing, and guessing wrong means a migration of every
 * stored object. Raised as `OQ-19`.
 */
export type Variant = "original" | "thumbnail" | "medium" | "large";

export const VARIANTS: readonly Variant[] = [
  "original",
  "thumbnail",
  "medium",
  "large",
];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** semver, as `template_versions.version` stores it. */
const VERSION = /^\d+\.\d+\.\d+$/;

/**
 * An asset filename. Deliberately strict: letters, digits, dot, dash, underscore, and
 * one extension.
 *
 * `hero-bg.jpg` passes. `../../../etc/passwd` does not, and neither does `a/b.jpg` --
 * a name containing a separator would let an asset escape its version's prefix and
 * land anywhere in the bucket, which is path traversal wearing an S3 hat.
 */
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.[A-Za-z0-9]{1,10}$/;

export class InvalidStoragePathError extends Error {
  constructor(what: string, value: unknown) {
    super(
      `Invalid ${what} for a storage path: ${JSON.stringify(String(value))}. ` +
        `Paths carry tenant identity (docs/ARCHITECTURE/05), so every component is validated.`,
    );
    this.name = "InvalidStoragePathError";
  }
}

function uuid(value: string, what: string): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new InvalidStoragePathError(what, value);
  return value.toLowerCase();
}

/**
 * A user's media object.
 *
 * `user-media/invitations/{invitation_id}/media/{media_id}/{variant}.webp`
 *
 * Always `.webp` -- `docs/BACKEND/04` step 6 generates every variant in WebP, so the
 * extension is not a parameter. Making it one would invite a caller to store whatever
 * the user uploaded under whatever extension they claimed.
 */
export function mediaKey(
  invitationId: string,
  mediaId: string,
  variant: Variant,
): StorageKey {
  if (!VARIANTS.includes(variant))
    throw new InvalidStoragePathError("variant", variant);

  const inv = uuid(invitationId, "invitation id");
  const med = uuid(mediaId, "media id");

  return `invitations/${inv}/media/${med}/${variant}.webp` as StorageKey;
}

/**
 * A template asset.
 *
 * `template-assets/templates/{template_id}/versions/{version}/assets/{asset_name}`
 */
export function templateAssetKey(
  templateId: string,
  version: string,
  assetName: string,
): StorageKey {
  const tpl = uuid(templateId, "template id");

  if (typeof version !== "string" || !VERSION.test(version)) {
    throw new InvalidStoragePathError("template version", version);
  }
  if (typeof assetName !== "string" || !ASSET_NAME.test(assetName)) {
    throw new InvalidStoragePathError("asset name", assetName);
  }

  return `templates/${tpl}/versions/${version}/assets/${assetName}` as StorageKey;
}

/**
 * An upload that has not been validated yet.
 *
 * `docs/BACKEND/04` Stage 1 step 5: a file that has passed only the extension, MIME and
 * magic-byte checks goes to "an ISOLATED staging area (not public-accessible)". It has
 * not been malware-scanned, not been decoded, and not had its EXIF stripped — so it is
 * not a media object yet and must not be reachable from a media path.
 *
 * Keyed by `media_id` alone: staging holds a file for a `media` row in `processing`, and
 * the invitation is knowable from that row. Leaving the invitation id out also means a
 * staging path cannot be confused for a permanent one by inspection.
 */
export function stagingKey(mediaId: string): StorageKey {
  return `uploads/${uuid(mediaId, "media id")}` as StorageKey;
}

/**
 * Adopt a key that was already stored, e.g. read back from `media.storage_path`.
 *
 * The escape hatch, and named so it reads as one at the call site. It validates the
 * shape rather than trusting it, so a corrupted or hand-edited row cannot become a
 * request for an arbitrary object.
 */
export function parseStoredKey(value: string): StorageKey {
  const patterns = [
    /^invitations\/[0-9a-f-]{36}\/media\/[0-9a-f-]{36}\/(original|thumbnail|medium|large)\.webp$/i,
    /^templates\/[0-9a-f-]{36}\/versions\/\d+\.\d+\.\d+\/assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.[A-Za-z0-9]{1,10}$/,
    /^uploads\/[0-9a-f-]{36}$/i,
  ];

  if (!patterns.some((p) => p.test(value))) {
    throw new InvalidStoragePathError("stored key", value);
  }
  return value as StorageKey;
}
