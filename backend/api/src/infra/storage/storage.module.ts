import { Global, Module, Inject } from "@nestjs/common";
import { S3Storage, InMemoryStorage, type StoragePort } from "@wi/storage";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";

/** Injection token for the storage port. */
export const STORAGE = Symbol("STORAGE");

/**
 * Object storage, behind the port from `@wi/storage`.
 *
 * The port is shared with the worker rather than duplicated, because both surfaces touch
 * storage: the API receives an upload into staging (`docs/BACKEND/04` Stage 1) and the
 * worker writes the variants (Stage 2). The `P0-15` record flagged duplicating the
 * logger across those two packages as a known problem; this does not repeat it.
 *
 * Nothing here exposes a bucket URL. `docs/ARCHITECTURE/05` § Access Control: files
 * "must never be accessible directly via the bucket URL", so reads go through the CDN
 * with origin access control and the port offers only a short-lived `presignGet`.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [ENV],
      useFactory: (env: Env): StoragePort => {
        // A test run with no storage configured gets the in-memory fake rather than a
        // client pointed at nothing. The alternative is every unit test needing MinIO,
        // which is the friction that ends with people not running tests.
        if (env.NODE_ENV === "test" && env.STORAGE_ENDPOINT === undefined) {
          return new InMemoryStorage();
        }

        return new S3Storage({
          endpoint: env.STORAGE_ENDPOINT ?? "",
          accessKeyId: env.STORAGE_ACCESS_KEY_ID ?? "",
          secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY ?? "",
          buckets: {
            "user-media": env.STORAGE_BUCKET_USER_MEDIA,
            "template-assets": env.STORAGE_BUCKET_TEMPLATE_ASSETS,
            staging: env.STORAGE_BUCKET_STAGING,
          },
        });
      },
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
