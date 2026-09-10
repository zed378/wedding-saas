import type { Bucket, StorageKey } from "./paths.js";

/**
 * The storage port. `docs/BACKEND/02` § Principles puts external I/O behind a port so it
 * is swappable and testable; `docs/ARCHITECTURE/05` allows S3, R2 or MinIO, and the
 * project uses MinIO locally and R2 in production (ADR-011).
 *
 * Two properties are enforced by the type rather than by convention:
 *
 *   1. **Every method takes a `StorageKey`, never a string.** Only `paths.ts` can produce
 *      one, so a caller cannot name an object. `docs/ARCHITECTURE/05` makes the path a
 *      tenant isolation control — it carries `invitation_id` "for isolation & audit
 *      purposes" — and a control that any call site can assemble is not a control.
 *
 *   2. **There is no `getPublicUrl`.** Buckets are private and access is through a CDN
 *      with origin access control (`docs/ARCHITECTURE/05` § Access Control): "files must
 *      never be accessible directly via the bucket URL". A method returning a bucket URL
 *      would be used, and would be the fastest way to undo that. Signed URLs exist as
 *      `presignGet`, which is time-bounded and auditable.
 */

export interface PutOptions {
  readonly contentType: string;
  /**
   * Cache-Control for the CDN. `docs/ARCHITECTURE/05` § CDN wants long, immutable
   * caching, which is safe because filenames are UUID + variant and a replacement gets
   * a new name rather than overwriting.
   */
  readonly cacheControl?: string;
  readonly contentLength?: number;
}

export interface StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string | undefined;
  readonly contentLength: number | undefined;
}

export interface StoragePort {
  put(
    bucket: Bucket,
    key: StorageKey,
    body: Uint8Array,
    options: PutOptions,
  ): Promise<void>;

  get(bucket: Bucket, key: StorageKey): Promise<StoredObject | null>;

  delete(bucket: Bucket, key: StorageKey): Promise<void>;

  exists(bucket: Bucket, key: StorageKey): Promise<boolean>;

  /**
   * A time-limited read URL.
   *
   * Not the primary read path — that is the CDN. This exists for the cases where a
   * signed URL is genuinely the answer: an admin inspecting a failed upload, a
   * one-off export. Short expiry by default, because a signed URL that outlives its
   * purpose is a public URL with extra steps.
   */
  presignGet(
    bucket: Bucket,
    key: StorageKey,
    expiresInSeconds?: number,
  ): Promise<string>;

  /**
   * Move an object between buckets, e.g. staging → permanent once validation passes.
   *
   * A copy followed by a delete. Not atomic, and the failure order matters: a copy that
   * succeeds and a delete that fails leaves an orphan in staging, which the hourly
   * `media_cleanup_staging` job removes. The reverse — deleting before copying — would
   * lose the file. So the order is fixed here rather than at each call site.
   */
  move(
    from: { bucket: Bucket; key: StorageKey },
    to: { bucket: Bucket; key: StorageKey },
  ): Promise<void>;
}

export class StorageError extends Error {
  /**
   * `override` because `Error` already declares `cause` (ES2022). Keeping the name is
   * deliberate -- `console.error` and pino both follow `cause` chains, so the driver's
   * real message reaches the log without anything having to unwrap it by hand.
   */
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StorageError";
    if (cause !== undefined) this.cause = cause;
  }
}
