import type { Bucket, StorageKey } from "./paths.js";
import type { PutOptions, StoragePort, StoredObject } from "./port.js";

/**
 * An in-memory `StoragePort`, for unit tests.
 *
 * The reason the port exists: everything above this package can be tested without a
 * bucket, a container or a network. A service that uploads three variants can assert it
 * uploaded three variants, to the right keys, without MinIO running.
 *
 * It is a faithful fake rather than a stub -- `move` copies then deletes in the same
 * order the real one does, `delete` on a missing key succeeds, `get` on a missing key
 * returns null. A fake that is easier to satisfy than the real thing produces tests that
 * pass against the fake and fail against production.
 */
export class InMemoryStorage implements StoragePort {
  private readonly objects = new Map<
    string,
    { body: Uint8Array; options: PutOptions }
  >();

  private id(bucket: Bucket, key: StorageKey): string {
    return `${bucket}::${key}`;
  }

  async put(
    bucket: Bucket,
    key: StorageKey,
    body: Uint8Array,
    options: PutOptions,
  ): Promise<void> {
    this.objects.set(this.id(bucket, key), { body, options });
  }

  async get(bucket: Bucket, key: StorageKey): Promise<StoredObject | null> {
    const stored = this.objects.get(this.id(bucket, key));
    if (stored === undefined) return null;
    return {
      body: stored.body,
      contentType: stored.options.contentType,
      contentLength: stored.body.byteLength,
    };
  }

  async delete(bucket: Bucket, key: StorageKey): Promise<void> {
    // Idempotent, as S3 is. A cleanup job retried after a partial success must not fail.
    this.objects.delete(this.id(bucket, key));
  }

  async exists(bucket: Bucket, key: StorageKey): Promise<boolean> {
    return this.objects.has(this.id(bucket, key));
  }

  async presignGet(
    bucket: Bucket,
    key: StorageKey,
    expiresInSeconds = 300,
  ): Promise<string> {
    // Shaped like a signed URL so a test can assert the expiry is bounded, without
    // pretending to be a real one.
    return `memory://${bucket}/${key}?expires=${expiresInSeconds}`;
  }

  async move(
    from: { bucket: Bucket; key: StorageKey },
    to: { bucket: Bucket; key: StorageKey },
  ): Promise<void> {
    const stored = this.objects.get(this.id(from.bucket, from.key));
    if (stored === undefined) return;
    this.objects.set(this.id(to.bucket, to.key), stored);
    this.objects.delete(this.id(from.bucket, from.key));
  }

  // ---------------------------------------------------------------- test helpers

  /** Every key currently stored, for assertions. */
  keys(bucket?: Bucket): string[] {
    const all = [...this.objects.keys()];
    return bucket === undefined
      ? all
      : all.filter((k) => k.startsWith(`${bucket}::`));
  }

  size(): number {
    return this.objects.size;
  }

  clear(): void {
    this.objects.clear();
  }
}
