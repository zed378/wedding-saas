import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { Bucket, StorageKey } from "./paths.js";
import {
  StorageError,
  type PutOptions,
  type StoragePort,
  type StoredObject,
} from "./port.js";

/**
 * S3-compatible storage. MinIO locally, Cloudflare R2 in production (ADR-011).
 *
 * One client, three buckets. `docs/ARCHITECTURE/05` requires at least `user-media` and
 * `template-assets`; `staging` is the isolated area `docs/BACKEND/04` Stage 1 step 5
 * asks for, holding files that have passed only the cheap checks and have not been
 * malware-scanned or decoded.
 */
export interface S3StorageConfig {
  readonly endpoint: string;
  readonly region?: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Real bucket names, so an environment can prefix or rename them. */
  readonly buckets: Record<Bucket, string>;
}

export class S3Storage implements StoragePort {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? "auto",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // MinIO serves buckets as a path, not a subdomain. R2 tolerates it too, so one
      // setting works for both rather than branching on the provider.
      forcePathStyle: true,
    });
  }

  private bucketName(bucket: Bucket): string {
    const name = this.config.buckets[bucket];
    if (name === undefined)
      throw new StorageError(`No bucket configured for "${bucket}"`);
    return name;
  }

  async put(
    bucket: Bucket,
    key: StorageKey,
    body: Uint8Array,
    options: PutOptions,
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName(bucket),
          Key: key,
          Body: body,
          ContentType: options.contentType,
          ...(options.cacheControl !== undefined
            ? { CacheControl: options.cacheControl }
            : {}),
          ...(options.contentLength !== undefined
            ? { ContentLength: options.contentLength }
            : {}),
        }),
      );
    } catch (cause) {
      // The driver's message can name the endpoint and the bucket. Wrapped so the
      // caller sees which operation failed, and the detail reaches only the log --
      // docs/SECURITY/08 forbids infrastructure detail in a client response, and the
      // error mapper in P0-13 only guarantees that for errors it recognises.
      throw new StorageError(`Failed to store object in ${bucket}`, cause);
    }
  }

  async get(bucket: Bucket, key: StorageKey): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      );
      const body = await result.Body?.transformToByteArray();
      if (body === undefined) return null;

      return {
        body,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
      };
    } catch (cause) {
      if (isNotFound(cause)) return null;
      throw new StorageError(`Failed to read object from ${bucket}`, cause);
    }
  }

  async delete(bucket: Bucket, key: StorageKey): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      );
    } catch (cause) {
      // S3 delete is idempotent -- removing something absent is a success. Treated the
      // same here so a retried cleanup job does not fail on its second run.
      if (isNotFound(cause)) return;
      throw new StorageError(`Failed to delete object from ${bucket}`, cause);
    }
  }

  async exists(bucket: Bucket, key: StorageKey): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      );
      return true;
    } catch (cause) {
      if (isNotFound(cause)) return false;
      throw new StorageError(`Failed to check object in ${bucket}`, cause);
    }
  }

  async presignGet(
    bucket: Bucket,
    key: StorageKey,
    expiresInSeconds = 300,
  ): Promise<string> {
    // Five minutes by default. A signed URL that outlives its purpose is a public URL
    // with extra steps, and docs/ARCHITECTURE/05 is explicit that files "must never be
    // accessible directly via the bucket URL".
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async move(
    from: { bucket: Bucket; key: StorageKey },
    to: { bucket: Bucket; key: StorageKey },
  ): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName(to.bucket),
          Key: to.key,
          CopySource: `${this.bucketName(from.bucket)}/${from.key}`,
        }),
      );
    } catch (cause) {
      throw new StorageError(
        `Failed to copy from ${from.bucket} to ${to.bucket}`,
        cause,
      );
    }

    // Copy first, delete second, and never the other way round. A failed delete leaves
    // an orphan in staging that media_cleanup_staging removes within the hour; a failed
    // copy after a delete would have lost the file outright.
    await this.delete(from.bucket, from.key);
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}
