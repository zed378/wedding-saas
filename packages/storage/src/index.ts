/**
 * `@wi/storage` — the object storage port and its implementations.
 *
 * Shared between the API (which receives uploads) and the worker (which processes them
 * and writes the variants), which is why it is a package rather than a folder in either.
 * The P0-15 record flagged duplicating the logger across those two surfaces as a known
 * problem; this avoids repeating that.
 */
export {
  mediaKey,
  templateAssetKey,
  stagingKey,
  parseStoredKey,
  InvalidStoragePathError,
  VARIANTS,
  type StorageKey,
  type Bucket,
  type Variant,
} from "./paths.js";

export {
  StorageError,
  type StoragePort,
  type PutOptions,
  type StoredObject,
} from "./port.js";

export { S3Storage, type S3StorageConfig } from "./s3-storage.js";
export { InMemoryStorage } from "./in-memory-storage.js";
